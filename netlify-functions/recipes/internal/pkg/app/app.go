package app

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/purge"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/telemetry"
	"sort"
	"time"

	jwtmiddleware "github.com/auth0/go-jwt-middleware/v2"
	"github.com/auth0/go-jwt-middleware/v2/jwks"
	"github.com/auth0/go-jwt-middleware/v2/validator"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humamux"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
	"github.com/urfave/negroni"
)

// App will hold the dependencies of the application
type App struct {
	db *sql.DB
	// purger invalidates Netlify's edge cache for /units after a write that may
	// have coined a Unit. Never nil: unconfigured, purge.Purger is itself a
	// no-op, which is what local development, e2e and CI get.
	purger cachePurger
	// catalogs holds the global Unit and Ingredient catalogs in process, so a
	// shopping-list request does not re-read the whole of both tables. Cleared
	// by the same handler that purges the edge caches - see purgeCatalogCaches.
	// A nil *service.Catalogs is a valid uncached cache, so nothing breaks if
	// an App is built without one.
	catalogs *service.Catalogs
}

// PurgeConfigured reports whether edge cache purging will actually happen, for
// the startup line in main.go. Unconfigured is correct locally and in CI and a
// misconfiguration on Fly, and nothing else tells the two apart.
func (a *App) PurgeConfigured() bool {
	p, ok := a.purger.(*purge.Purger)
	return ok && p.Configured()
}

// cachePurger is the slice of purge.Purger the handlers use.
//
// An interface rather than the concrete type only so a test can see that a
// write purges, and purges the right tag - the alternative was exporting a
// test-only constructor from the purge package. Purge takes no error return
// and gives nothing back on purpose: see purge.Purger.Purge.
type cachePurger interface {
	Purge(tag string)
}

type contextKey string

// NewApp returns the application itself
func NewApp(env *common.Env) (*App, error) {
	app := &App{
		db:       env.DB,
		purger:   purge.New(),
		catalogs: service.NewCatalogs(),
	}
	return app, nil
}

func healthHandler(w http.ResponseWriter, req *http.Request) {
	w.Write([]byte("ok"))
}

// defaultCacheControl is what every response carries unless its handler says
// otherwise. Twenty-two of the twenty-five registered operations are
// account-scoped and mutable and want exactly this. (follow-ups.md #44 counts
// nineteen of twenty-two; three routes have been added since it was written,
// all account-scoped.)
//
// It is a default rather than something each route opts into because the
// failure mode is asymmetric: forgetting `no-store` on an account-scoped route
// lets an intermediary hand one Account's Shopping List to another, while
// forgetting to opt a new global catalog route *into* caching merely costs a
// round trip. So a route added tomorrow inherits the safe answer, and the three
// routes that are genuinely public have to say so deliberately - see
// tags.go, units.go and ingredients.go.
const defaultCacheControl = "private, no-store"

// cacheControlMiddleware stamps defaultCacheControl on every response before
// dispatch.
//
// Before, no route set any cache header at all, which is not the same as
// forbidding caching - it leaves the decision to whatever intermediary is in
// the path. Since ADR-0006 there is one: browser traffic reaches the API
// through Netlify's edge via netlify.toml's `/api/bigshop/*` rewrite.
//
// Set on the header map *before* next runs, so a handler that sets
// Cache-Control itself (via a Huma output `header:"Cache-Control"` field)
// simply replaces this value rather than fighting it. Deliberately positioned
// ahead of the JWT middleware so it also covers the responses that middleware
// produces itself - a 401 is exactly the kind of response that must not be
// cached and handed to the next caller.
func cacheControlMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	w.Header().Set("Cache-Control", defaultCacheControl)
	next.ServeHTTP(w, r)
}

// jwksCacheTTL is how long the tenant's key set is held in process.
//
// The trade-off it settles: CachingProvider caches the whole key set for the
// TTL and does *not* refresh on an unknown `kid`, so a token signed by a key
// minted inside the current window would be refused until the window expires.
// Five minutes is chosen against that. The tenant publishes two keys at once,
// so a new key appears in the JWKS well before Auth0 signs anything with it,
// which makes the exposure theoretical rather than live.
const jwksCacheTTL = 5 * time.Minute

// jwtHandler builds the negroni handler that validates Auth0 tokens, wrapping
// the *jwtmiddleware.JWTMiddleware that newJWTMiddleware constructs.
//
// Built once, when the router is. That is the entire point of the change it
// came from: `getPemCert` fetched the tenant's JWKS over HTTPS on *every*
// request, so Big Shop's request rate was its Auth0 request rate, and a rate
// limit or an incident on that endpoint failed every request rather than just
// logins. A provider constructed per request would cache nothing and restore
// exactly that.
//
// Unconfigured, it refuses every request rather than returning an error, which
// looks odd until you notice `go run . openapi` builds this same router with no
// Auth0 environment at all (main.go's spec-generation mode, and a CI drift
// gate). Failing here would break the build for a path that never serves a
// request; refusing every request is the fail-closed answer for the path that
// does.
func jwtHandler() negroni.HandlerFunc {
	middleware, err := newJWTMiddleware()
	if err != nil {
		log.Printf("auth is not configured, every request will be refused: %v", err)
		return func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
			// Deliberately the same body a bad token gets. Whether this API is
			// misconfigured is not something an unauthenticated caller should
			// be able to read off the response.
			unauthorized(w, r, reasonUnconfigured, "JWT is invalid.")
		}
	}

	// v2 has no HandlerWithNext, which is what v1 handed negroni directly.
	// CheckJWT wraps a handler instead, so negroni's continuation goes in as
	// that handler - which keeps this middleware exactly where it sat in the
	// stack, behind cacheControlMiddleware and the /health carve-out.
	return func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		middleware.CheckJWT(next).ServeHTTP(w, r)
	}
}

func newJWTMiddleware() (*jwtmiddleware.JWTMiddleware, error) {
	domain := os.Getenv("AUTH0_DOMAIN")
	audience := os.Getenv("AUTH0_AUDIENCE")
	if domain == "" || audience == "" {
		return nil, errors.New("AUTH0_DOMAIN and AUTH0_AUDIENCE are both required")
	}

	issuerURL, err := url.Parse("https://" + domain + "/")
	if err != nil {
		return nil, err
	}

	provider := jwks.NewCachingProvider(issuerURL, jwksCacheTTL)

	// Issuer and audience are checked by the validator itself, and both are
	// required rather than checked-if-present - a token this tenant signed for
	// some other audience is exactly what this API must refuse.
	jwtValidator, err := validator.New(
		provider.KeyFunc,
		validator.RS256,
		issuerURL.String(),
		[]string{audience},
	)
	if err != nil {
		return nil, err
	}

	return jwtmiddleware.New(jwtValidator.ValidateToken, jwtmiddleware.WithErrorHandler(authErrorHandler)), nil
}

// authErrorHandler answers 401 for a refused token, whether it was missing or
// invalid, while still saying which.
//
// Not cosmetic. v2's DefaultErrorHandler answers a *missing* token with 400 and
// only an invalid one with 401, where v1 answered 401 for both - so taking the
// default would change what every unauthenticated request gets back, which is a
// contract change no part of this work asked for. TestDefaultCacheControl pins
// it directly. Only the status is overridden; the two cases keep the distinct
// messages the library would have given them.
func authErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, jwtmiddleware.ErrJWTMissing):
		unauthorized(w, r, reasonTokenMissing, "JWT is missing.")
	case errors.Is(err, jwtmiddleware.ErrJWTInvalid):
		unauthorized(w, r, reasonTokenInvalid, "JWT is invalid.")
	default:
		// Stamped before delegating, because DefaultErrorHandler writes the
		// response itself and this is the last point that still knows the
		// refusal happened here.
		telemetry.SetAuthFailureReason(r.Context(), reasonOther)
		jwtmiddleware.DefaultErrorHandler(w, r, err)
	}
}

// userMiddleware lifts the authenticated subject out of the validated JWT and
// puts it in the request context, where the handlers read it.
//
// Runs only after the JWT middleware, so the claims should always be present -
// but the assertion is guarded anyway and answers 401 rather than panicking if
// they are not. The line this replaced chained three unchecked assertions
// (`Value("user").(*jwt.Token).Claims.(jwt.MapClaims)["sub"].(string)`), any of
// which would panic on a shape it did not expect. There is no Recovery
// middleware in the negroni stack, so that panic is an empty reply rather than
// a response - the same defect #49 fixed one layer further down.
func (a *App) userMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	claims, ok := r.Context().Value(jwtmiddleware.ContextKey{}).(*validator.ValidatedClaims)
	if !ok || claims.RegisteredClaims.Subject == "" {
		unauthorized(w, r, reasonClaimsMissing, "JWT is invalid.")
		return
	}

	next.ServeHTTP(w, r.WithContext(a.withCaller(r.Context(), claims.RegisteredClaims.Subject)))
}

// withCaller puts a Caller for this request into the context.
//
// A method on *App because the Caller needs the database to resolve the
// Account - lazily, so a route that never asks for an Account still makes no
// query at all. One Caller per request, never shared.
//
// The lookup closes over the request's context, so the one query it may make is
// attributed to the request that caused it like every other - the middleware
// runs inside the server span, so this is the same span the handler would have
// passed in had the Caller taken a context of its own.
func (a *App) withCaller(ctx context.Context, userID string) context.Context {
	caller := common.NewCaller(userID, func() (int, error) {
		return service.GetAccountID(ctx, a.db, userID)
	}, func() (bool, error) {
		return service.IsAdmin(ctx, a.db, userID)
	})
	return context.WithValue(ctx, contextKey("caller"), caller)
}

// callerFrom lifts the request's Caller back out of the context.
//
// Panics if it is absent, which is deliberate and safe: every route is behind
// either userMiddleware or devUserMiddleware, both of which install one, so an
// absent Caller means the middleware stack has been misassembled - a
// programming error that should fail loudly in the first test that runs, not
// resolve to a zero user ID that quietly reads another Account's data.
func callerFrom(ctx context.Context) *common.Caller {
	return ctx.Value(contextKey("caller")).(*common.Caller)
}

// userSub is the authenticated subject for the request's telemetry span, or ""
// when there isn't one.
//
// A named function rather than the closure it used to be, so it can be tested.
// It could not be, and it was wrong: Phase 3 of
// specs/completed/request-model-optimisations.md replaced the bare `userID` string in the
// context with a *common.Caller and left this reading `contextKey("userID")` -
// a key nothing writes any more. Every span shipped without a user.sub from
// then until now, which is precisely the failure telemetry.Middleware's own
// comment warns about, arriving from the other direction. Nothing could notice,
// because an absent attribute looks exactly like a request with no user.
//
// Comma-ok rather than callerFrom's deliberate panic. callerFrom is called from
// handlers, where a missing Caller means the middleware stack is misassembled
// and should fail loudly. Here it would mean a *trace attribute* taking down a
// request that was otherwise fine, which ADR-0007 forbids outright.
func userSub(r *http.Request) string {
	caller, ok := r.Context().Value(contextKey("caller")).(*common.Caller)
	if !ok {
		return ""
	}
	return caller.UserID
}

// The closed set of values for the auth.failure_reason span attribute.
//
// Constants rather than literals at the call sites because the point of the
// attribute is to be queryable: a fifth spelling invented in passing is not a
// new fact in Grafana, it is a filter that silently matches nothing. Declared
// here, in the package that does the refusing, rather than in telemetry, which
// should not know what the auth chain's failure modes are.
//
// Deliberately coarser than the message sent to the caller. tokenInvalid covers
// every way a present token can be refused - expired, wrong audience, wrong
// issuer, bad signature, unknown kid - because go-jwt-middleware collapses them
// all into ErrJWTInvalid before this code sees them, and inventing a
// distinction the library does not draw would put a value on the span that
// nothing can be trusted to set correctly.
const (
	// No Authorization header, or one the library could not read a token from.
	reasonTokenMissing = "token_missing"
	// A token was present and was refused. See above for why this is one value.
	reasonTokenInvalid = "token_invalid"
	// The token validated, but carried no usable subject. Distinct from
	// tokenInvalid because it means the tenant and this API disagree about the
	// shape of a valid token, which is a configuration fault rather than a
	// caller's.
	reasonClaimsMissing = "claims_missing"
	// This deployment has no Auth0 environment, so *every* request is refused.
	// One span with this on it is worth more than any amount of staring at a
	// 100% error rate, which is what it otherwise looks like.
	reasonUnconfigured = "auth_unconfigured"
	// go-jwt-middleware returned an error that is neither of its two exported
	// sentinels. Nothing produces this today; it exists so that if something
	// starts to, the span says "unclassified" rather than saying nothing.
	reasonOther = "other"
)

// unauthorized writes the 401 body shape go-jwt-middleware itself uses, so a
// refusal looks the same wherever in the auth chain it came from, and records
// on the request's span which way that was.
//
// The two happen together, in one function, on purpose. The span attribute is
// the only account of a 401 that survives the request - telemetry.Middleware
// never runs on this path - so a refusal path added later that wrote the body
// without stamping the span would be invisible in exactly the way this change
// exists to fix. Taking the reason as a parameter alongside the message makes
// that omission impossible rather than merely discouraged.
//
// The request is here only to reach the span through its context; nothing about
// the response depends on it.
func unauthorized(w http.ResponseWriter, r *http.Request, reason, message string) {
	telemetry.SetAuthFailureReason(r.Context(), reason)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"message":"` + message + `"}`))
}

// devUserMiddleware stands in for the jwt+user middleware pair when
// DISABLE_AUTH=true, so the API can be run locally (`go run . serve`) without a
// real Auth0 token. The user ID it injects must exist in the local DB
// (account_user) for requests to resolve to an account.
func (a *App) devUserMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	devUserID := os.Getenv("DEV_USER_ID")
	if devUserID == "" {
		devUserID = "local-dev-user"
	}
	next.ServeHTTP(w, r.WithContext(a.withCaller(r.Context(), devUserID)))
}

// RouteTemplates lists the path templates registered on an API - "/recipes",
// "/recipe/{id}" and so on.
//
// This is the authority for what counts as a known route, and it comes from the
// router itself rather than a hand-kept list precisely so it cannot drift: add
// an operation and its template is in here the moment it is registered. What
// depends on that is telemetry's label cardinality - see telemetry.route.
func RouteTemplates(api huma.API) []string {
	paths := api.OpenAPI().Paths
	templates := make([]string, 0, len(paths))
	for p := range paths {
		templates = append(templates, p)
	}
	sort.Strings(templates)
	return templates
}

// GetRouter returns the application router and the Huma API instance backing
// it, from which the OpenAPI spec can be generated (see the `openapi` mode in
// main.go) without needing to start a server or hold a DB connection.
func (a *App) GetRouter(base string) (*negroni.Negroni, huma.API, error) {

	router := mux.NewRouter()

	// All operations are registered on this subrouter so that `base` (the
	// Netlify function's path prefix) becomes the OpenAPI server URL rather
	// than being repeated in every operation's path.
	sub := router.PathPrefix(base).Subrouter()
	config := huma.DefaultConfig("Big Shop API", "1.0.0")
	config.Info.Description = "The Go API backing Big Shop, a recipe management and meal planning app."
	config.Servers = []*huma.Server{{URL: base}}
	api := humamux.New(sub, config)

	a.registerRecipesRoutes(api)
	a.registerIngredientsRoutes(api)
	a.registerRecipeRoutes(api)
	a.registerListRoutes(api)
	a.registerUnitsRoutes(api)
	a.registerTagsRoutes(api)
	a.registerAccountRoutes(api)
	a.registerUserRoutes(api)
	a.registerConsentRoutes(api)
	a.registerInviteRoutes(api)

	c := cors.New(cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
		AllowedOrigins:   []string{"*"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	healthPath := base + "/health"

	n := negroni.New(negroni.NewLogger())
	// First in the stack, so that everything below it carries a cache policy -
	// including /health, which is answered by the carve-out below without ever
	// reaching a handler that could set one.
	n.Use(negroni.HandlerFunc(cacheControlMiddleware))
	// /health must stay reachable without a JWT - it's used by uptime monitors,
	// Fly's own health check and Lambda warmers, none of which can hold an
	// Auth0 token - so it's handled before CORS/auth even run, not registered
	// on the mux router.
	//
	// Answered at two paths. `base + "/health"` is the real one, and is what
	// fly.toml checks: it travels the same prefix as live traffic, so it fails
	// if the base path is ever misconfigured, where a root-only check would sit
	// green while every actual route 404s. Bare "/health" is an alias for
	// humans and uptime monitors, who reach for it first and got a confusing
	// 401 - the request fell past this carve-out into the JWT middleware.
	isHealthCheck := func(r *http.Request) bool {
		return r.Method == http.MethodGet && (r.URL.Path == healthPath || r.URL.Path == "/health")
	}
	n.Use(negroni.HandlerFunc(func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		if isHealthCheck(r) {
			healthHandler(w, r)
			return
		}
		next(w, r)
	}))
	n.Use(c)

	// The three global catalogs are reachable without a token, like /health and
	// unlike everything else.
	//
	// This is not a relaxation - it is the gate catching up with a decision
	// ADR-0009 already made. Each of these routes answers `public` with an
	// `s-maxage`, which instructs a *shared* cache to store the response and
	// hand it to whoever asks next. That is the whole point of them, and it
	// means the contents were already public the moment the first response was
	// cached: a gate a CDN is licensed to serve around is not a gate. ADR-0009
	// says as much in each handler's comment ("`public` makes this readable by
	// an unauthenticated caller"), and until now that was aspirational rather
	// than true.
	//
	// Making it true is what lets Recipe Import read /ingredients through the
	// edge at all (follow-ups.md #51). A shared CDN will not reliably store a
	// response to a request carrying Authorization, so as long as the only way
	// to get one was to send a token, the cache headers were decoration.
	//
	// What is exposed is exactly what ADR-0001 defines as global and
	// non-personal: Ingredient names, Unit names, and the seeded Tag list. No
	// account is named, no Recipe is reachable, and none of the three handlers
	// takes a Caller - which is checked below rather than trusted, because a
	// handler that started needing one would otherwise panic in production
	// rather than fail here.
	catalogPaths := map[string]bool{
		base + "/ingredients": true,
		base + "/units":       true,
		base + "/tags":        true,
	}
	isPublicCatalog := func(r *http.Request) bool {
		return r.Method == http.MethodGet && catalogPaths[r.URL.Path]
	}

	// Both branches are wrapped as one unit rather than skipped individually,
	// because the JWT and user middlewares are a pair: running the second
	// without the first is the "misassembled stack" callerFrom's comment warns
	// about, and skipping only one would be exactly that.
	var auth negroni.HandlerFunc
	if os.Getenv("DISABLE_AUTH") == "true" {
		auth = a.devUserMiddleware
	} else {
		jwt := jwtHandler()
		auth = func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
			jwt(w, r, func(w2 http.ResponseWriter, r2 *http.Request) {
				a.userMiddleware(w2, r2, next)
			})
		}
	}
	n.Use(negroni.HandlerFunc(func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		if isPublicCatalog(r) {
			next(w, r)
			return
		}
		auth(w, r, next)
	}))
	// After the auth pair, deliberately: the server span is opened outside this
	// whole stack (main.go wraps it), but the identity that makes the span worth
	// finding is only on the context once one of the two middlewares above has
	// put it there. Before them, there is nothing to record.
	//
	// The accessor is passed in rather than let telemetry read the context
	// itself, because contextKey is unexported and Go compares context keys by
	// type - see telemetry.Middleware's comment.
	n.Use(negroni.HandlerFunc(telemetry.Middleware(base, RouteTemplates(api), userSub)))
	n.UseHandler(router)

	return n, api, nil
}
