package main

import (
	"context"
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
	_ "github.com/go-sql-driver/mysql"
	"github.com/urfave/negroni"
)

var negroniLambda *negroniadapter.NegroniAdapter
var router *negroni.Negroni

func init() {
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

	router, err = application.GetRouter(".netlify/functions/recipes")
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
	if len(args) > 1 && args[1] == "dev" {
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
