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

// isOpenAPIMode reports whether the process was invoked as `go run . openapi`,
// which prints the generated OpenAPI spec and exits - no DB connection is
// needed since route registration never touches it.
func isOpenAPIMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "openapi"
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

		_, api, err := application.GetRouter("/.netlify/functions/recipes")
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

	router, _, err = application.GetRouter("/.netlify/functions/recipes")
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
	args := os.Args
	if isOpenAPIMode() {
		spec, err := openapiAPI.OpenAPI().YAML()
		if err != nil {
			panic(err.Error())
		}
		fmt.Print(string(spec))
	} else if len(args) > 1 && args[1] == "dev" {
		server := http.Server{
			Addr:         ":8080",
			ReadTimeout:  3000 * time.Millisecond,
			WriteTimeout: 3000 * time.Millisecond,
			Handler:      router,
		}
		server.ListenAndServe()
	} else {
		lambda.Start(handler)
	}
}
