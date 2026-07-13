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
		db: env.DB,
	}
	return app, nil
}

func healthHandler(w http.ResponseWriter, req *http.Request) {
	w.Write([]byte("ok"))
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
			// Have to fiddle with the types here due to a casting issue in
			// the package https://github.com/form3tech-oss/jwt-go/issues/7
			aud := token.Claims.(jwt.MapClaims)["aud"].([]interface{})
			s := make([]string, len(aud))
			for i, v := range aud {
				s[i] = fmt.Sprint(v)
			}
			token.Claims.(jwt.MapClaims)["aud"] = s

			checkAud := token.Claims.(jwt.MapClaims).VerifyAudience(os.Getenv("AUTH0_AUDIENCE"), false)
			if !checkAud {
				return token, errors.New("Invalid audience")
			}

			iss := "https://" + os.Getenv("AUTH0_DOMAIN") + "/"
			checkIss := token.Claims.(jwt.MapClaims).VerifyIssuer(iss, false)
			if !checkIss {
				return token, errors.New("invalid issuer")
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
	// /health must stay reachable without a JWT - it's used by uptime monitors
	// and Lambda warmers, none of which can hold an Auth0 token - so it's
	// handled before CORS/auth even run, not registered on the mux router.
	n.Use(negroni.HandlerFunc(func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		if r.Method == http.MethodGet && r.URL.Path == healthPath {
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
	n.UseHandler(router)

	return n, api, nil
}
