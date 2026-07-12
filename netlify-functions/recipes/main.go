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
	"recipes/internal/pkg/service"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	negroniadapter "github.com/awslabs/aws-lambda-go-api-proxy/negroni"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/urfave/negroni"
)

var negroniLambda *negroniadapter.NegroniAdapter
var router *negroni.Negroni
var appEnv *common.Env

func init() {
	mysql.RegisterTLSConfig("tidb", &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: "gateway01.eu-central-1.prod.aws.tidbcloud.com",
	})

	db, err := sql.Open("mysql", os.Getenv("DSN"))

	if err != nil {
		fmt.Println("Failed to connect to database")
		panic(err.Error())
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping: %v", err)
	}

	env := &common.Env{DB: db}
	appEnv = env

	application, err := app.NewApp(env)

	if err != nil {
		fmt.Println("Failed to create application")
		fmt.Println(err)
	}

	router, err = application.GetRouter("/.netlify/functions/recipes")
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
	switch {
	case len(args) > 1 && args[1] == "dev":
		server := http.Server{
			Addr:         ":8080",
			ReadTimeout:  3000 * time.Millisecond,
			WriteTimeout: 3000 * time.Millisecond,
			Handler:      router,
		}
		server.ListenAndServe()
	case len(args) > 1 && args[1] == "backfill-ingredients":
		// One-off: propose a preferred_unit/average_weight_grams for every
		// ingredient that doesn't have one yet, via the same LLM
		// classification new ingredients get. See spec/unit-normalisation.md.
		if err := service.BackfillIngredientClassifications(appEnv.DB); err != nil {
			log.Fatalf("backfill failed: %v", err)
		}
	default:
		lambda.Start(handler)
	}
}
