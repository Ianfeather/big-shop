package app

import (
	"context"
	"net/http"

	"recipes/internal/pkg/service"
	"recipes/internal/pkg/telemetry"

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
	recipes, err := service.GetAllRecipes(ctx, a.db, userID)

	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to get recipes from db"), err)
	}

	summaries := make([]RecipeSummary, len(recipes))
	for i, r := range recipes {
		summaries[i] = RecipeSummary(r)
	}

	// A structural count, not content: how many Recipes came back is exactly the
	// kind of thing worth knowing when reconstructing a slow request afterwards,
	// and their names are exactly what ADR-0008 §1 says must not be here.
	//
	// InfoContext, not Info: the trace_id is read from the context, and a log
	// line without one still arrives in Loki but can no longer be tied to the
	// trace it belongs to.
	telemetry.Logger().InfoContext(ctx, "listed recipes", "recipe.count", len(summaries))

	return &RecipesOutput{Body: summaries}, nil
}

func (a *App) registerRecipesRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "list-recipes",
		Method:      http.MethodGet,
		Path:        "/recipes",
		Summary:     "List recipes",
		Description: "Returns a lightweight (name/id/tags only) list of every Recipe belonging to the current user's Account.",
		Tags:        []string{"Recipes"},
	}, a.getRecipes)
}
