package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// IngredientName is service.Ingredient under a distinct name: Huma's schema
// registry names components after the bare (package-less) Go type name, and
// that would otherwise collide with common.Ingredient.
type IngredientName service.Ingredient

// IngredientsOutput is the response body for listing ingredients.
type IngredientsOutput struct {
	Body []IngredientName
}

func (a *App) getIngredients(ctx context.Context, _ *struct{}) (*IngredientsOutput, error) {
	ingredients, err := service.GetAllIngredients(a.db)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get ingredients from db")
	}

	names := make([]IngredientName, len(ingredients))
	for i, ing := range ingredients {
		names[i] = IngredientName(ing)
	}

	return &IngredientsOutput{Body: names}, nil
}

func (a *App) registerIngredientsRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-ingredients",
		Method:      http.MethodGet,
		Path:        "/ingredients",
		Summary:     "List ingredients",
		Description: "Returns every Ingredient known to the system, used for autosuggest when adding a Recipe.",
		Tags:        []string{"Ingredients"},
	}, a.getIngredients)
}
