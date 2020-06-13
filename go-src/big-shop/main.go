package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"big-shop/go-src/internal/pkg/app"
	"big-shop/go-src/internal/pkg/common"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/gorillamux"

	_ "github.com/go-sql-driver/mysql"
)

var muxLambda *gorillamux.GorillaMuxAdapter

func init() {
	pass := os.Getenv("DB_PASSWORD")
	dbHost := os.Getenv("DB_HOST")
	db, err := sql.Open("mysql", fmt.Sprintf("admin:%s@tcp(%s:3306)/bigshop", pass, dbHost))

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
