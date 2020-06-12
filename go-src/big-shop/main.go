package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

	"big-shop/go-src/internal/pkg/app"
	"big-shop/go-src/internal/pkg/common"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/gorillamux"

	_ "github.com/go-sql-driver/mysql"
)

var muxLambda *gorillamux.GorillaMuxAdapter

func fooHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Hello FOO")
}

func barHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Hello BAR")
}

func init() {

	db, err := sql.Open("mysql", "recipe_app@tcp(127.0.0.1:3306)/shoppinglist")

	if err != nil {
		fmt.Println("Failed to connect to database")
		panic(err.Error())
	}

	env := &common.Env{DB: db}

	application, err := app.NewApp(env)

	if err != nil {
		fmt.Println("Failed to create application")
		fmt.Println(err)
	}

	r, err := application.GetRouter("/.netlify/functions/big-shop")
	if err != nil {
		fmt.Println("Failed to get application router")
		fmt.Println(err)
	}

	muxLambda = gorillamux.New(r)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return muxLambda.ProxyWithContext(ctx, req)
}

func main() {
	lambda.Start(handler)
}
