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

// GetRouter returns the application router
func (a *App) GetRouter(base string) (*negroni.Negroni, error) {

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

	router.HandleFunc(base+"/health", healthHandler).Methods("GET")
	router.HandleFunc(base+"/recipes", a.recipesHandler).Methods("GET")
	router.HandleFunc(base+"/ingredients", a.ingredientsHandler).Methods("GET")
	router.HandleFunc(base+"/recipe/{slug:[a-zA-Z-]+}", a.recipeHandlerBySlug).Methods("GET")
	router.HandleFunc(base+"/recipe/{id:[0-9]+}", a.recipeHandlerByID).Methods("GET")
	router.HandleFunc(base+"/recipe", a.addRecipeHandler).Methods("POST")
	router.HandleFunc(base+"/recipe", a.editRecipeHandler).Methods("PUT")
	router.HandleFunc(base+"/recipe", a.deleteRecipeHandler).Methods("DELETE")
	router.HandleFunc(base+"/shopping-list", a.getListHandler).Methods("GET")
	router.HandleFunc(base+"/shopping-list", a.createListHandler).Methods("POST")
	router.HandleFunc(base+"/shopping-list/buy", a.buyListItemHandler).Methods("PATCH")
	router.HandleFunc(base+"/shopping-list/extra", a.addExtraListItem).Methods("POST")
	router.HandleFunc(base+"/shopping-list/clear", a.clearListHandler).Methods("DELETE")
	router.HandleFunc(base+"/units", a.getUnitsHandler).Methods("GET")
	router.HandleFunc(base+"/tags", a.getTagsHandler).Methods("GET")
	router.HandleFunc(base+"/account", a.getAccount).Methods("GET")
	router.HandleFunc(base+"/account/add", a.addUserToAccount).Methods("POST")
	router.HandleFunc(base+"/account/remove", a.removeUserFromAccount).Methods("DELETE")
	router.HandleFunc(base+"/user", a.addUser).Methods("POST")
	router.HandleFunc(base+"/invite", a.inviteUser).Methods("POST")
	router.HandleFunc(base+"/invites", a.getInvites).Methods("GET")
	router.HandleFunc(base+"/invite/accept", a.acceptInvite).Methods("POST")
	router.HandleFunc(base+"/invite/reject", a.rejectInvite).Methods("POST")

	c := cors.New(cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
		AllowedOrigins:   []string{"*"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	n := negroni.New(negroni.NewLogger())
	n.Use(c)
	n.Use(negroni.HandlerFunc(jwtMiddleware.HandlerWithNext))
	n.Use(negroni.HandlerFunc(userMiddleware))
	n.UseHandler(router)

	return n, nil
}
