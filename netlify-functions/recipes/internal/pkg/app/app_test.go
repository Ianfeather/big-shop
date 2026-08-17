package app

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"recipes/internal/pkg/common"

	"github.com/danielgtaylor/huma/v2"
	// Registered for its side effect only, so sql.Open("mysql", ...) above has
	// a driver. main.go imports it for the same reason; the app package never
	// names it outside this test.
	_ "github.com/go-sql-driver/mysql"

	jose "gopkg.in/go-jose/go-jose.v2"
	josejwt "gopkg.in/go-jose/go-jose.v2/jwt"
)

const testAudience = "https://api.bigshop.test"

// A refused request answers 401, whichever way it was refused.
//
// This is a guard against a regression the go-jwt-middleware v2 upgrade would
// otherwise have shipped silently. v1 answered 401 for a missing token; v2's
// DefaultErrorHandler answers *400* for one, reserving 401 for a token that is
// present but invalid. Every unauthenticated request to this API would have
// changed status code, which is a contract change nothing asked for - so
// app.go passes WithErrorHandler(authErrorHandler) to keep 401.
//
// Both cases matter: the missing-token one is what the override exists for, and
// the unconfigured one is the fail-closed path for a deploy with no Auth0
// environment, which `go run . openapi` also travels.
func TestRefusalsAnswer401(t *testing.T) {
	t.Run("when the token is missing", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+"/shopping-list", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401 (v2's default for a missing token is 400)", rec.Code)
		}
		// Only the status is overridden, not the diagnosis - a caller who sent
		// no token should not be told their token is invalid.
		if got := rec.Body.String(); !strings.Contains(got, "JWT is missing") {
			t.Errorf("body = %q, want it to say the JWT is missing", got)
		}
	})

	t.Run("when auth is not configured at all", func(t *testing.T) {
		t.Setenv("DISABLE_AUTH", "")
		t.Setenv("AUTH0_DOMAIN", "")
		t.Setenv("AUTH0_AUDIENCE", "")

		application, err := NewApp(&common.Env{})
		if err != nil {
			t.Fatalf("NewApp() error = %v", err)
		}
		// Must still build - `go run . openapi` builds this router with no
		// Auth0 environment, and a CI job diffs its output.
		router, _, err := application.GetRouter(testBase)
		if err != nil {
			t.Fatalf("GetRouter() error = %v", err)
		}

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+"/shopping-list", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401 - an unconfigured API must refuse, not serve", rec.Code)
		}
	})
}

const testBase = "/api/bigshop"

// newRouter builds the real negroni stack over a nil-DB App.
//
// None of the tests here touch the database, and route registration never does
// either, so a nil DB is fine. DISABLE_AUTH is pinned by the caller rather than
// inherited because docker-compose.yml sets it to "true" for the api service,
// so running these through `docker compose run api` would otherwise silently
// take a different branch than the one under test.
func newRouter(t *testing.T, disableAuth string) http.Handler {
	t.Helper()
	t.Setenv("DISABLE_AUTH", disableAuth)
	// Both are required for the JWT middleware to be built at all - without
	// them GetRouter installs the refuse-everything handler instead, and a test
	// asserting a 401 would pass without the middleware under test ever
	// running. The domain cannot resolve, which is fine: every assertion here
	// is about a request that is refused before any key lookup happens.
	t.Setenv("AUTH0_DOMAIN", "tenant.invalid")
	t.Setenv("AUTH0_AUDIENCE", testAudience)
	application, err := NewApp(&common.Env{})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	router, _, err := application.GetRouter(testBase)
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}
	return router
}

// Every response must carry a cache policy, and the default one must be safe.
//
// The risk this guards is not a missed optimisation: since ADR-0006 browser
// traffic reaches this API through Netlify's edge, and a `public` response on
// an account-scoped route would let one Account's Shopping List be cached from
// an authenticated request and served to whoever asks next (Authorization is
// not part of Netlify's cache key). So `private, no-store` has to be what a
// route gets by *default*, not what it remembers to ask for.
//
// Both cases below are chosen to need no database, and between them they cover
// the two ways a response can be produced: by the middleware stack on its own,
// and by Huma.
func TestDefaultCacheControl(t *testing.T) {
	assertDefault := func(t *testing.T, rec *httptest.ResponseRecorder) {
		t.Helper()
		if got := rec.Header().Get("Cache-Control"); got != defaultCacheControl {
			t.Errorf("Cache-Control = %q, want %q", got, defaultCacheControl)
		}
	}

	// Refused by the JWT middleware, well before routing - so this pins that
	// the header survives a response no handler was ever asked for.
	t.Run("on a 401 the JWT middleware produces", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+"/shopping-list", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401; this test proves nothing otherwise", rec.Code)
		}
		assertDefault(t, rec)
	})

	// Past auth and into Huma, which rejects the malformed body itself without
	// calling the handler - so nothing reaches the nil DB. This is the path
	// that matters: Huma writes the output struct's own headers here, and from
	// the next session on, three routes use exactly that mechanism to override
	// this default. A middleware that only survived to the auth layer would
	// look fine on the case above and be useless in production.
	t.Run("on a response Huma produces", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, testBase+"/recipe", strings.NewReader("not json"))
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		newRouter(t, "true").ServeHTTP(rec, req)

		// 400, not 422: Huma cannot parse the body at all, so it never gets as
		// far as validating it against the schema.
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; the request reached somewhere unexpected", rec.Code)
		}
		assertDefault(t, rec)
	})
}

// Exactly three routes may override app.go's default, and they are the three
// global catalogs. The other twenty-two registered operations are
// account-scoped, and a `public` on any of them would let one Account's data be
// cached from an authenticated request and served to whoever asks next,
// authenticated or not - Authorization is not part of Netlify's cache key.
//
// Read out of the OpenAPI document Huma builds, which is the same one
// docs/openapi.yaml is generated from, so the set of routes cannot drift from
// what is actually served. The expected set below is still hand-kept - the
// point is that adding a route does not silently widen it.
//
// What this cannot see: a header set imperatively (middleware, ctx.SetHeader)
// never reaches the OpenAPI document, and neither does a non-Huma route like
// /health.
func TestOnlyTheGlobalCatalogsOverrideTheDefault(t *testing.T) {
	t.Setenv("DISABLE_AUTH", "true")
	application, err := NewApp(&common.Env{})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	_, api, err := application.GetRouter(testBase)
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}

	declaring := map[string]bool{}
	var operations int
	for path, item := range api.OpenAPI().Paths {
		// Every method huma.PathItem can carry, not just the five in use today
		// - the whole value of reading the registered routes is that a later
		// one cannot slip past.
		for _, op := range []*huma.Operation{
			item.Get, item.Put, item.Post, item.Delete,
			item.Patch, item.Options, item.Head, item.Trace,
		} {
			if op == nil {
				continue
			}
			operations++
			for status, resp := range op.Responses {
				if !strings.HasPrefix(status, "2") {
					continue
				}
				// Case-insensitively: huma keys this map on the struct tag
				// verbatim, so `header:"cache-control"` would key lowercase
				// here while still going out canonicalised on the wire.
				for name := range resp.Headers {
					if strings.EqualFold(name, "Cache-Control") {
						declaring[op.Method+" "+path] = true
					}
				}
			}
		}
	}

	want := map[string]bool{
		"GET /tags":        true,
		"GET /units":       true,
		"GET /ingredients": true,
	}
	for route := range declaring {
		if !want[route] {
			t.Errorf("%s declares its own Cache-Control; only the three global catalogs may", route)
		}
	}
	for route := range want {
		if !declaring[route] {
			t.Errorf("%s no longer declares a Cache-Control; it has fallen back to the default", route)
		}
	}

	// #44 was written against 22 operations, of which it called nineteen
	// account-scoped. Three have been added since. Not asserted exactly -
	// adding a route is normal and should not fail a cache test - but a count
	// that has collapsed means the loop above stopped seeing anything and the
	// checks passed vacuously.
	if operations < 25 {
		t.Errorf("walked %d operations, expected at least the 25 registered", operations)
	}
}

// Pins what each route actually emits.
//
// Asserted through withCachePolicy rather than on the constants, which is the
// whole point: comparing `unitsCacheControl` to its own literal would still
// pass with `tagsCacheControl` wired into UnitsOutput, and that swap - a day's
// TTL on the Open catalog - is the one mistake here with no symptom until a
// purge is missed. Going through the method asks each output type what it
// stamps, which is what the handler returns.
//
// The handlers themselves are out of reach without a database, so the proof
// that a real 200 carries these lives in the live-stack verification recorded
// on the PR.
func TestEachRouteStampsItsOwnPolicy(t *testing.T) {
	// A day: the `tag` table is seeded by migration and never written to, so
	// there is nothing to purge and nothing to go stale.
	if got := (&TagsOutput{}).withCachePolicy().CacheControl; got != "public, max-age=0, s-maxage=86400" {
		t.Errorf("/tags Cache-Control = %q", got)
	}

	// Five minutes: the backstop behind the purge, not the intended freshness.
	units := (&UnitsOutput{}).withCachePolicy()
	if got := units.CacheControl; got != "public, max-age=0, s-maxage=300" {
		t.Errorf("/units Cache-Control = %q", got)
	}
	// A purge names a tag; a response carries one. If the two stop matching,
	// the purge becomes a silent no-op - stale units and no error anywhere.
	if units.NetlifyCacheTag != UnitsCacheTag || UnitsCacheTag != "units" {
		t.Errorf("/units Netlify-Cache-Tag = %q, UnitsCacheTag = %q", units.NetlifyCacheTag, UnitsCacheTag)
	}

	// Five minutes and a tag, matching /units exactly. This route was
	// `no-store` until follow-ups.md #51 pointed Recipe Import at the edge
	// rather than at Fly directly - before that there was no shared cache in
	// the path for a header to talk to.
	ingredients := (&IngredientsOutput{}).withCachePolicy()
	if got := ingredients.CacheControl; got != "public, max-age=0, s-maxage=300" {
		t.Errorf("/ingredients Cache-Control = %q", got)
	}
	if ingredients.NetlifyCacheTag != IngredientsCacheTag || IngredientsCacheTag != "ingredients" {
		t.Errorf("/ingredients Netlify-Cache-Tag = %q, IngredientsCacheTag = %q", ingredients.NetlifyCacheTag, IngredientsCacheTag)
	}

	// The two Open catalogs must not share a tag. They are purged together
	// today, so a copy-paste here would look correct right up until one of them
	// needed purging alone.
	if IngredientsCacheTag == UnitsCacheTag {
		t.Errorf("both Open catalogs use the tag %q", UnitsCacheTag)
	}
}

// spyPurger records what was purged. Locked because the real Purger is called
// from request handlers and is safe to use concurrently - a spy that is not
// would turn a future concurrent test into a race rather than a failure.
type spyPurger struct {
	mu   sync.Mutex
	tags []string
}

func (s *spyPurger) Purge(tag string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tags = append(s.tags, tag)
}

// A Recipe create or edit runs insertUnits and insertIngredients, either of
// which can coin a row the cached /units or /ingredients response does not have
// - so both writes purge both edge caches.
//
// Exercised through purgeCatalogCaches rather than through addRecipe/editRecipe,
// which cannot be reached without a database. What that leaves untested is the
// call site itself; the e2e suite covers it by saving real Recipes, and a
// missing call would show up there as a stale catalog rather than an error.
//
// purgeCatalogCaches also clears the API's own in-process copy of the catalogs,
// which this cannot see - Catalogs deliberately exposes no "is it loaded". That
// half is covered by service's catalog_cache_test.go, and the reason all three
// live in one method rather than three call sites is written up there and on
// purgeCatalogCaches itself. The interesting failure is clearing one and not
// another: the client would see a new Unit immediately while the Shopping List
// went on combining without it, which reads as a combining bug.
func TestRecipeWritesPurgeBothOpenCatalogs(t *testing.T) {
	spy := &spyPurger{}
	// catalogs is left nil on purpose: a nil *service.Catalogs invalidates
	// harmlessly, which is the property that lets a test assemble an App from
	// only the fields it cares about.
	application := &App{purger: spy}

	application.purgeCatalogCaches()

	sort.Strings(spy.tags)
	want := []string{IngredientsCacheTag, UnitsCacheTag}
	sort.Strings(want)
	if !slices.Equal(spy.tags, want) {
		t.Errorf("purged %v, want exactly %v", spy.tags, want)
	}

	// /tags is seeded by migration and never written to, so purging it would
	// only spend Netlify's rate limit against a catalog that cannot go stale.
	if slices.Contains(spy.tags, "tags") {
		t.Error("purged the tags cache; /tags is seeded by migration and never written to")
	}
}

// The three global catalogs answer without a token, like /health and unlike
// every other route.
//
// This is what makes their `public, s-maxage` headers mean anything: a shared
// CDN will not reliably store a response to a request carrying Authorization,
// so as long as a token was required the cache policy was decoration. It is
// also the thing most likely to be "tidied" back by someone reading the
// middleware stack and seeing an exception with no obvious reason - hence a
// test that names the reason.
//
// Exercised with auth *enabled* and no token presented: a non-401 means the
// request never reached the JWT middleware. The handler behind it then fails on
// the database, which is fine and is the assertion working - a 500 here is a
// request that got all the way through, which is exactly what is being checked.
//
// The database is opened against an unroutable port rather than left nil.
// `database/sql` dials lazily, so this costs no connection at registration, but
// a nil *sql.DB segfaults inside `(*DB).conn` the moment a handler queries it -
// a panic, not a status, and nothing to assert on. A refused connection gives
// the handler a real error to turn into a 500.
func TestGlobalCatalogsAnswerWithoutAToken(t *testing.T) {
	t.Setenv("DISABLE_AUTH", "")
	t.Setenv("AUTH0_DOMAIN", "example.auth0.com")
	t.Setenv("AUTH0_AUDIENCE", "https://big-shop-api")

	db, err := sql.Open("mysql", "nobody:nothing@tcp(127.0.0.1:1)/none")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	application, err := NewApp(&common.Env{DB: db})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	router, _, err := application.GetRouter(testBase)
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}

	for _, path := range []string{"/ingredients", "/units", "/tags"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+path, nil))

			if rec.Code == http.StatusUnauthorized {
				t.Errorf("GET %s = 401; the global catalogs must answer without a token", path)
			}
		})
	}

	// The carve-out is by path *and* method. A write is not a catalog read, and
	// nothing else may slip through beside them.
	t.Run("does not exempt other routes", func(t *testing.T) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+"/recipes", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET /recipes = %d, want 401 - only the three catalogs are exempt", rec.Code)
		}
	})
}

// The /health carve-out sits ahead of CORS and the JWT middleware in the
// negroni stack, which is the only reason an uptime monitor or Fly's health
// check - neither of which can hold an Auth0 token - can reach it at all. That
// makes it easy to break by reordering middleware and not notice, since every
// other route would carry on working.
//
// Deliberately exercised with auth *enabled*: a 200 here means the request
// never reached the JWT middleware. No token is ever presented, so the JWT
// middleware rejects before it would fetch JWKS - no network.
func TestHealthCarveOut(t *testing.T) {
	const base = testBase

	status := func(t *testing.T, method, path string) int {
		t.Helper()
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		return rec.Code
	}

	t.Run("answers under the base path, which is what fly.toml checks", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, base+"/health", nil))

		if rec.Code != http.StatusOK {
			t.Errorf("GET %s/health = %d, want 200", base, rec.Code)
		}
		if got := rec.Body.String(); got != "ok" {
			t.Errorf("body = %q, want %q", got, "ok")
		}
	})

	// The alias. Without it this returned 401, because the request fell past
	// the carve-out into the JWT middleware - confusing enough that it was the
	// first thing reported after the Fly app went live.
	t.Run("answers at the root as well", func(t *testing.T) {
		if code := status(t, http.MethodGet, "/health"); code != http.StatusOK {
			t.Errorf("GET /health = %d, want 200", code)
		}
	})

	// The carve-out answers before any handler runs, so the only thing that can
	// give it a cache policy is the middleware sitting above it.
	t.Run("carries the default cache policy", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

		if got := rec.Header().Get("Cache-Control"); got != defaultCacheControl {
			t.Errorf("Cache-Control = %q, want %q", got, defaultCacheControl)
		}
	})

	// The carve-out is GET-only, so a HEAD falls past it. Worth pinning, because
	// `curl -I` against /health then fails on a perfectly healthy deploy - which
	// has already sent one runbook verification check the wrong way. Asserted as
	// "not 200" rather than a specific code: what it becomes (401 from auth, 404
	// from the mux) is not the point, only that it is not served.
	t.Run("does not carve out non-GET methods", func(t *testing.T) {
		if code := status(t, http.MethodHead, "/health"); code == http.StatusOK {
			t.Error("HEAD /health = 200; the carve-out is meant to be GET-only")
		}
	})
}

// TestKeyLookupFailureIsRefusedNotPanicked covers the last panic on the auth
// path. A token whose `kid` names no key in the tenant's JWKS is something any
// unauthenticated caller can send, and the key lookup used to panic on it: the
// process survived (net/http recovers per-connection) but the caller got an
// empty reply rather than a 401, and the connection was torn down.
//
// AUTH0_DOMAIN is pointed at a name that cannot resolve, which fails the same
// lookup one step earlier - no JWKS fixture, and no network. The claims below
// have to match the environment exactly, because the audience and issuer
// checks run *before* the key lookup and would otherwise be what rejects the
// token, proving nothing.
func TestKeyLookupFailureIsRefusedNotPanicked(t *testing.T) {
	t.Setenv("DISABLE_AUTH", "")
	t.Setenv("AUTH0_AUDIENCE", testAudience)
	t.Setenv("AUTH0_DOMAIN", "tenant.invalid")

	application, err := NewApp(&common.Env{})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	router, _, err := application.GetRouter("/api/bigshop")
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}

	// Signed with a throwaway key, so the signature is valid RS256 and parsing
	// gets as far as the key lookup. Which key signed it is irrelevant - the
	// lookup fails before anything is verified against it.
	//
	// Minted with go-jose because that is what go-jwt-middleware v2 brings;
	// this was form3tech-oss/jwt-go until that dependency was retired with v1.
	// Only the construction changed - every assertion below is the original.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	// The `kid` rides on the signing key rather than being set as a raw header,
	// which is what puts "no-such-key" in the JOSE header and so is the whole
	// point of the fixture.
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "no-such-key"}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	signed, err := josejwt.Signed(signer).Claims(josejwt.Claims{
		Issuer:   "https://tenant.invalid/",
		Audience: josejwt.Audience{testAudience},
		Subject:  "auth0|unknown-kid",
		Expiry:   josejwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).CompactSerialize()
	if err != nil {
		t.Fatalf("CompactSerialize() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/bigshop/shopping-list", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()

	// A panic here fails the test by unwinding it, which is the regression.
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET /shopping-list with an unknown kid = %d, want 401", rec.Code)
	}
}

// The span's user.sub must come from wherever the middleware actually puts the
// identity, and this is the only thing that can say so.
//
// It is a regression test for a defect that shipped and went unnoticed for two
// pull requests. The accessor GetRouter hands telemetry used to be an inline
// closure reading `contextKey("userID")`; Phase 3 of
// specs/completed/request-model-optimisations.md replaced that string in the context with
// a *common.Caller and did not update it, so it read a key nothing writes and
// every span went out with no user.sub at all.
//
// Nothing could catch it. An attribute that is absent is indistinguishable from
// a request that genuinely had no user, so the traces looked plausible, the
// tests passed, and the only symptom was a dashboard filter that matched
// nothing. Hence a direct test of the accessor rather than of the span: the
// coupling between "where the identity is stored" and "where telemetry looks
// for it" is the thing that broke, and it is invisible from any other angle.
func TestTheSpanCarriesTheAuthenticatedSubject(t *testing.T) {
	// A nil DB is fine: withCaller's Account lookup is lazy and nothing here
	// resolves it.
	application := &App{}
	ctx := application.withCaller(context.Background(), "auth0|somebody")

	req := httptest.NewRequest(http.MethodGet, testBase+"/shopping-list", nil).WithContext(ctx)
	if got := userSub(req); got != "auth0|somebody" {
		t.Errorf("userSub = %q, want %q", got, "auth0|somebody")
	}
}

// Before the auth middlewares there is no Caller, and /health never passes
// through them at all. Reading the identity must be a no-op there, not a panic:
// a trace attribute taking down an otherwise fine request is exactly what
// ADR-0007 forbids.
func TestTheSpanTolerantlyHasNoSubjectBeforeAuth(t *testing.T) {
	if got := userSub(httptest.NewRequest(http.MethodGet, testBase+"/health", nil)); got != "" {
		t.Errorf("userSub with no Caller = %q, want empty", got)
	}
}
