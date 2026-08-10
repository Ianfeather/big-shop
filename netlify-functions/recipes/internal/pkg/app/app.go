package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/purge"
	"recipes/internal/pkg/telemetry"

	jwtmiddleware "github.com/auth0/go-jwt-middleware"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humamux"
	"github.com/form3tech-oss/jwt-go"
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

// Jwks will hold the response from the public server
type Jwks struct {
	Keys []JSONWebKeys `json:"keys"`
}

// JSONWebKeys refers to the remove public key data
type JSONWebKeys struct {
	Kty string   `json:"kty"`
	Kid string   `json:"kid"`
	Use string   `json:"use"`
	N   string   `json:"n"`
	E   string   `json:"e"`
	X5c []string `json:"x5c"`
}

type contextKey string

// NewApp returns the application itself
func NewApp(env *common.Env) (*App, error) {
	app := &App{
		db:     env.DB,
		purger: purge.New(),
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

func userMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	ctx := context.WithValue(
		r.Context(),
		contextKey("userID"),
		// TODO: Add account ID here too via DB lookup?
		r.Context().Value("user").(*jwt.Token).Claims.(jwt.MapClaims)["sub"].(string),
	)
	next.ServeHTTP(w, r.WithContext(ctx))
}

// devUserMiddleware stands in for the jwt+user middleware pair when
// DISABLE_AUTH=true, so the API can be run locally (`go run . dev`) without a
// real Auth0 token. The user ID it injects must exist in the local DB
// (account_user) for requests to resolve to an account.
func devUserMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	devUserID := os.Getenv("DEV_USER_ID")
	if devUserID == "" {
		devUserID = "local-dev-user"
	}
	ctx := context.WithValue(r.Context(), contextKey("userID"), devUserID)
	next.ServeHTTP(w, r.WithContext(ctx))
}

// normalizeAudience rewrites the `aud` claim into a shape MapClaims.
// VerifyAudience understands.
//
// It accepts only []string or string and returns false for anything else,
// while encoding/json decodes a JSON array into []interface{} - which is what
// Auth0 sends whenever a token was requested with an audience. Hence the
// conversion (https://github.com/form3tech-oss/jwt-go/issues/7).
//
// Returns an error rather than asserting. The `claims["aud"].([]interface{})`
// this replaced panicked outright on a token whose `aud` was absent or a bare
// string, and there is no Recovery middleware in the negroni stack to turn
// that into a response - so an unauthenticated request could kill the handler
// instead of being refused by it.
func normalizeAudience(claims jwt.MapClaims) error {
	switch aud := claims["aud"].(type) {
	case []interface{}:
		values := make([]string, len(aud))
		for i, v := range aud {
			value, ok := v.(string)
			if !ok {
				return errors.New("invalid audience")
			}
			values[i] = value
		}
		claims["aud"] = values
	case []string, string:
		// Already a shape VerifyAudience reads.
	default:
		return errors.New("missing audience")
	}
	return nil
}

func getPemCert(token *jwt.Token) (string, error) {
	cert := ""
	resp, err := http.Get("https://" + os.Getenv("AUTH0_DOMAIN") + "/.well-known/jwks.json")

	if err != nil {
		return cert, err
	}
	defer resp.Body.Close()

	var jwks = Jwks{}
	err = json.NewDecoder(resp.Body).Decode(&jwks)

	if err != nil {
		return cert, err
	}

	for k := range jwks.Keys {
		if token.Header["kid"] == jwks.Keys[k].Kid {
			cert = "-----BEGIN CERTIFICATE-----\n" + jwks.Keys[k].X5c[0] + "\n-----END CERTIFICATE-----"
		}
	}

	if cert == "" {
		err := errors.New("unable to find appropriate key")
		return cert, err
	}

	return cert, nil
}

// GetRouter returns the application router and the Huma API instance backing
// it, from which the OpenAPI spec can be generated (see the `openapi` mode in
// main.go) without needing to start a server or hold a DB connection.
func (a *App) GetRouter(base string) (*negroni.Negroni, huma.API, error) {

	jwtMiddleware := jwtmiddleware.New(jwtmiddleware.Options{
		ValidationKeyGetter: func(token *jwt.Token) (interface{}, error) {
			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				return nil, errors.New("invalid claims")
			}

			if err := normalizeAudience(claims); err != nil {
				return nil, err
			}

			// Both claims are *required*, not merely checked-if-present. With
			// the `false` this passed before, verifyAud returns true for an
			// empty `aud` and VerifyIssuer returns true for a token carrying
			// no `iss` at all - so any token the tenant's key signed was
			// accepted, whatever it was minted for. The signature check below
			// meant that was never an open door, but a token issued by this
			// Auth0 tenant for some other audience is exactly what this API
			// must refuse.
			if !claims.VerifyAudience(os.Getenv("AUTH0_AUDIENCE"), true) {
				return nil, errors.New("invalid audience")
			}

			iss := "https://" + os.Getenv("AUTH0_DOMAIN") + "/"
			if !claims.VerifyIssuer(iss, true) {
				return nil, errors.New("invalid issuer")
			}

			cert, err := getPemCert(token)
			if err != nil {

				panic(err.Error())
			}
			result, _ := jwt.ParseRSAPublicKeyFromPEM([]byte(cert))
			fmt.Println("valid token:")
			fmt.Println(result)
			return result, nil
		},
		SigningMethod: jwt.SigningMethodRS256,
	})

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
	if os.Getenv("DISABLE_AUTH") == "true" {
		n.Use(negroni.HandlerFunc(devUserMiddleware))
	} else {
		n.Use(negroni.HandlerFunc(jwtMiddleware.HandlerWithNext))
		n.Use(negroni.HandlerFunc(userMiddleware))
	}
	// After the auth pair, deliberately: the server span is opened outside this
	// whole stack (main.go wraps it), but the identity that makes the span worth
	// finding is only on the context once one of the two middlewares above has
	// put it there. Before them, there is nothing to record.
	//
	// The accessor is passed in rather than let telemetry read the context
	// itself, because contextKey is unexported and Go compares context keys by
	// type - see telemetry.Middleware's comment.
	n.Use(negroni.HandlerFunc(telemetry.Middleware(base, func(r *http.Request) string {
		sub, _ := r.Context().Value(contextKey("userID")).(string)
		return sub
	})))
	n.UseHandler(router)

	return n, api, nil
}
