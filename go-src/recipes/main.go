package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/gorillamux"
	"github.com/gorilla/mux"
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
	fmt.Printf("GMux Cold Start")

	r := mux.NewRouter()
	r.HandleFunc("/", fooHandler)
	r.HandleFunc("/bar", barHandler)

	muxLambda = gorillamux.New(r)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	fmt.Println(req)
	return muxLambda.ProxyWithContext(ctx, req)
}

func main() {
	lambda.Start(handler)
}
