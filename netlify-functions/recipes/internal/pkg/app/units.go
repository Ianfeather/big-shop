package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// UnitsOutput is the response body for listing units.
type UnitsOutput struct {
	Body []service.Unit
}

func (a *App) getUnits(ctx context.Context, _ *struct{}) (*UnitsOutput, error) {
	units, err := service.GetAllUnits(a.db)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get units from db")
	}

	return &UnitsOutput{Body: units}, nil
}

func (a *App) registerUnitsRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-units",
		Method:      http.MethodGet,
		Path:        "/units",
		Summary:     "List units",
		Description: "Returns every Unit an Ingredient Line's quantity can be expressed in.",
		Tags:        []string{"Units"},
	}, a.getUnits)
}
