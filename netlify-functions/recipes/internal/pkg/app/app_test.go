package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"recipes/internal/pkg/common"

	"github.com/danielgtaylor/huma/v2"

	"github.com/form3tech-oss/jwt-go"
)

const (
	testAudience = "https://api.bigshop.test"
	testIssuer   = "https://tenant.eu.auth0.com/"
)

func TestNormalizeAudience(t *testing.T) {
	t.Run("converts the []interface{} a JSON array decodes to", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{testAudience, testIssuer + "userinfo"}}

		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		got, ok := claims["aud"].([]string)
		if !ok {
			t.Fatalf("aud is %T, want []string", claims["aud"])
		}
		if len(got) != 2 || got[0] != testAudience {
			t.Errorf("aud = %v", got)
		}
	})

	t.Run("leaves a bare string audience alone", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": testAudience}

		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}
		if claims["aud"] != testAudience {
			t.Errorf("aud = %v, want it untouched", claims["aud"])
		}
	})

	// Both of these panicked before, taking the request down with no response
	// rather than refusing it - there is no Recovery middleware in the stack.
	t.Run("rejects a token carrying no audience", func(t *testing.T) {
		if err := normalizeAudience(jwt.MapClaims{"iss": testIssuer}); err == nil {
			t.Error("normalizeAudience() = nil, want an error")
		}
	})

	t.Run("rejects a non-string value in the audience array", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{testAudience, 42}}

		if err := normalizeAudience(claims); err == nil {
			t.Error("normalizeAudience() = nil, want an error")
		}
	})
}

// Guards the `true` (required) argument in GetRouter's VerifyAudience and
// VerifyIssuer calls. Every case here verified successfully under the `false`
// this replaced, which meant any token the Auth0 tenant's key had signed was
// accepted regardless of what it was minted for.
func TestRequiredClaims(t *testing.T) {
	t.Run("an empty audience array does not satisfy the audience", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{}, "iss": testIssuer}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = true for an empty aud")
		}
	})

	t.Run("a token minted for another audience does not verify", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{"https://other-api.test"}, "iss": testIssuer}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = true for another audience")
		}
	})

	t.Run("a token carrying no issuer does not verify", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []string{testAudience}}

		if claims.VerifyIssuer(testIssuer, true) {
			t.Error("VerifyIssuer() = true for a missing iss")
		}
	})

	// The shape Auth0 actually issues: an array holding this API's audience
	// alongside the tenant's /userinfo endpoint.
	t.Run("a genuine access token still verifies", func(t *testing.T) {
		claims := jwt.MapClaims{
			"aud": []interface{}{testAudience, testIssuer + "userinfo"},
			"iss": testIssuer,
		}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if !claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = false for a genuine token")
		}
		if !claims.VerifyIssuer(testIssuer, true) {
			t.Error("VerifyIssuer() = false for a genuine token")
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

	// Not cached, and deliberately not `private` either - see the constant.
	if got := (&IngredientsOutput{}).withCachePolicy().CacheControl; got != "no-store" {
		t.Errorf("/ingredients Cache-Control = %q", got)
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

// A Recipe create or edit runs insertUnits, which can coin a Unit the cached
// /units response does not have - so both purge the edge cache.
//
// Exercised through purgeUnitsCache rather than through addRecipe/editRecipe,
// which cannot be reached without a database. What that leaves untested is the
// call site itself; the e2e suite covers it by saving real Recipes, and a
// missing call would show up there as a stale unit list rather than an error.
func TestRecipeWritesPurgeTheUnitsCache(t *testing.T) {
	spy := &spyPurger{}
	application := &App{purger: spy}

	application.purgeUnitsCache()

	if len(spy.tags) != 1 || spy.tags[0] != UnitsCacheTag {
		t.Errorf("purged %v, want exactly [%s]", spy.tags, UnitsCacheTag)
	}
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
