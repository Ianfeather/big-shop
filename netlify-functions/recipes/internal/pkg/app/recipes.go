package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// RecipeSummary is service.Recipe under a distinct name: Huma's schema
// registry names components after the bare (package-less) Go type name, and
// that would otherwise collide with common.Recipe.
type RecipeSummary service.Recipe

// RecipesOutput is the response body for listing recipes.
type RecipesOutput struct {
	Body []RecipeSummary
}

func (a *App) getRecipes(ctx context.Context, _ *struct{}) (*RecipesOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	recipes, err := service.GetAllRecipes(a.db, userID)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get recipes from db")
	}

	summaries := make([]RecipeSummary, len(recipes))
	for i, r := range recipes {
		summaries[i] = RecipeSummary(r)
	}

	return &RecipesOutput{Body: summaries}, nil
}

func (a *App) registerRecipesRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-recipes",
		Method:      http.MethodGet,
		Path:        "/recipes",
		Summary:     "List recipes",
		Description: "Returns a lightweight (name/id/tags only) list of every Recipe belonging to the current user's Account.",
		Tags:        []string{"Recipes"},
	}, a.getRecipes)
}
