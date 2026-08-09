package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"recipes/internal/pkg/app"
	"recipes/internal/pkg/common"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	negroniadapter "github.com/awslabs/aws-lambda-go-api-proxy/negroni"
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/urfave/negroni"
)

var negroniLambda *negroniadapter.NegroniAdapter
var router *negroni.Negroni
var openapiAPI huma.API

// purgeConfigured is captured at startup so main can report it. Held here
// rather than read from the environment again so that what is logged is what
// the App actually built, not a second guess at it.
var purgeConfigured bool

// basePath is the prefix every route is registered under when this runs as a
// server - the Fly container in production, and `serve` locally - and it is the
// OpenAPI server URL. Netlify rewrites it to the Fly origin with status = 200,
// which keeps the API same-origin to the browser. /api alone would swallow the
// Next.js routes under pages/api, hence the second segment. Changing this means
// regenerating docs/openapi.yaml and types/api.d.ts - both are drift-checked in
// CI.
const basePath = "/api/bigshop"

// lambdaBasePath is what the Netlify Function has always served, and goes on
// serving unchanged.
//
// It is not simply the old value of basePath. Netlify routes a request to a
// function by the function's own path, so the Lambda has to keep registering
// routes under that prefix or it 404s on everything the moment this branch
// deploys. That would quietly destroy the rollback the whole migration rests
// on: specs/api-hosting-migration.md's Phase 4 says rollback is "reverting
// those values and redeploying. The Lambda is still there, still serving its
// old path, untouched" - which is only true if it really is untouched. So the
// two servers coexist through the cooling-off period, on different paths,
// against the same database.
//
// Deleted along with the lambda.Start branch in Phase 5.
const lambdaBasePath = "/.netlify/functions/recipes"

// isOpenAPIMode reports whether the process was invoked as `go run . openapi`,
// which prints the generated OpenAPI spec and exits - no DB connection is
// needed since route registration never touches it.
func isOpenAPIMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "openapi"
}

// isServeMode reports whether the process should run as a plain HTTP server:
// the production container on Fly, `npm run dev:full`, and the e2e stack.
// `dev` is the name this mode had when it was only ever used locally; it is
// still accepted so CLAUDE.md's documented invocation and anyone's muscle
// memory keep working.
func isServeMode() bool {
	return len(os.Args) > 1 && (os.Args[1] == "serve" || os.Args[1] == "dev")
}

// routerBasePath picks the prefix for the mode this process is running in.
// Anything that is not the OpenAPI printer or a server is the Lambda.
func routerBasePath() string {
	if isOpenAPIMode() || isServeMode() {
		return basePath
	}
	return lambdaBasePath
}

func init() {
	mysql.RegisterTLSConfig("tidb", &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: "gateway01.eu-central-1.prod.aws.tidbcloud.com",
	})

	if isOpenAPIMode() {
		application, err := app.NewApp(&common.Env{})
		if err != nil {
			fmt.Println("Failed to create application")
			fmt.Println(err)
			return
		}

		_, api, err := application.GetRouter(basePath)
		if err != nil {
			fmt.Println("Failed to get application router")
			fmt.Println(err)
			return
		}
		openapiAPI = api
		return
	}

	db, err := sql.Open("mysql", os.Getenv("DSN"))

	if err != nil {
		fmt.Println("Failed to connect to database")
		panic(err.Error())
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping: %v", err)
	}

	env := &common.Env{DB: db}

	application, err := app.NewApp(env)

	if err != nil {
		fmt.Println("Failed to create application")
		fmt.Println(err)
	}
	purgeConfigured = application.PurgeConfigured()

	router, _, err = application.GetRouter(routerBasePath())
	if err != nil {
		fmt.Println("Failed to get application router")
		fmt.Println(err)
	}

	negroniLambda = negroniadapter.New(router)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return negroniLambda.ProxyWithContext(ctx, req)
}

func main() {
	if isOpenAPIMode() {
		spec, err := openapiAPI.OpenAPI().YAML()
		if err != nil {
			panic(err.Error())
		}
		fmt.Print(string(spec))
	} else if isServeMode() {
		// Said once at startup because the failure it describes is silent
		// otherwise: with only one of NETLIFY_PURGE_TOKEN/NETLIFY_SITE_ID set,
		// or neither, /units is never invalidated and simply expires on its
		// s-maxage. That is the correct behaviour locally and in CI, and a
		// misconfiguration on Fly - and nothing else distinguishes the two.
		if purgeConfigured {
			log.Println("edge cache purging enabled")
		} else {
			log.Println("edge cache purging disabled (NETLIFY_PURGE_TOKEN and NETLIFY_SITE_ID must both be set); /units will expire on its s-maxage instead")
		}

		// This branch is no longer dev-only: it is what the production
		// container on Fly runs too (see Dockerfile), so its timeouts now
		// apply to real traffic for the first time - the lambda.Start path
		// below never used them. The old 3s read/write pair would have cut
		// off anything slower than that, shopping-list generation being the
		// obvious candidate. WriteTimeout covers handler execution, and sits
		// above the Netlify proxy's own 26s ceiling so the proxy is what
		// gives up first rather than the origin truncating a response
		// mid-flight.
		server := http.Server{
			Addr:         ":8080",
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  120 * time.Second,
			Handler:      router,
		}
		// Fatal rather than ignored: a bind failure used to exit 0 silently,
		// which on Fly would be a restart loop with no reason recorded.
		log.Fatal(server.ListenAndServe())
	} else {
		lambda.Start(handler)
	}
}
