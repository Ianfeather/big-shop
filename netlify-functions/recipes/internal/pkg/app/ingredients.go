package app

import (
	"context"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// IngredientName is service.Ingredient under a distinct name: Huma's schema
// registry names components after the bare (package-less) Go type name, and
// that would otherwise collide with common.Ingredient.
type IngredientName service.Ingredient

// ingredientsCacheControl is the third answer of the three the cache audit
// (follow-ups.md #44) arrived at, and the only one that declines to cache.
//
// /ingredients looks exactly like /tags and /units - no account scoping, the
// same bytes for every caller - so it is easy to assume it wants the same
// treatment. It does not, because of *who reads it*. Its only consumer is
// lib/recipe-import/known-names.ts, which runs server-side in a Netlify
// function and calls Fly directly via API_HOST_INTERNAL. That request never
// crosses Netlify's edge, so an `s-maxage` here would be a header nothing ever
// acts on, plus the accepted downside of `public` for no upside at all.
//
// This is stated rather than left to the default because the absence of a
// header on the one route in this file would read as an oversight next to the
// two beside it. The real win for this route is an in-process cache in
// known-names.ts, which is separate work - see follow-ups.md.
//
// `no-store` without `private`: unlike the account-scoped routes, there is
// nothing personal here to keep out of a shared cache - the point is only that
// caching it buys nothing.
const ingredientsCacheControl = "no-store"

// IngredientsOutput is the response body for listing ingredients.
type IngredientsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         []IngredientName
}

// withCachePolicy stamps this route's policy onto the response. See the same
// method on UnitsOutput for why it is a method rather than a field assignment.
func (o *IngredientsOutput) withCachePolicy() *IngredientsOutput {
	o.CacheControl = ingredientsCacheControl
	return o
}

func (a *App) getIngredients(ctx context.Context, _ *struct{}) (*IngredientsOutput, error) {
	ingredients, err := service.GetAllIngredients(ctx, a.db)

	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to get ingredients from db"), err)
	}

	names := make([]IngredientName, len(ingredients))
	for i, ing := range ingredients {
		names[i] = IngredientName(ing)
	}

	return (&IngredientsOutput{Body: names}).withCachePolicy(), nil
}

func (a *App) registerIngredientsRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "list-ingredients",
		Method:      http.MethodGet,
		Path:        "/ingredients",
		Summary:     "List ingredients",
		Description: "Returns every Ingredient name known to the system. Read server-side during Recipe Import to tell the model which names already exist, so it reuses one instead of coining a near-duplicate.",
		Tags:        []string{"Ingredients"},
	}, a.getIngredients)
}
