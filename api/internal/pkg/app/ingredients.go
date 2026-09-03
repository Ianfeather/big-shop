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

// ingredientsCacheControl matches unitsCacheControl exactly, and for the same
// reasons: a global catalog with no account scoping, Open rather than fixed, so
// a short shared TTL with a purge on write.
//
// **This route used to be `no-store`, and the reasoning for that was sound but
// its premise has changed.** The cache audit (follow-ups.md #44) declined to
// cache /ingredients not because it is uncacheable but because of *who reads
// it*: its only consumer is lib/recipe-import/known-names.ts, which ran in a
// Netlify function calling Fly directly via API_HOST_INTERNAL - a request that
// never crossed Netlify's edge, making an `s-maxage` here a header nothing
// would ever act on. follow-ups.md #51 changed that premise by routing the call
// through www.bigshop.life, so the header now has a cache to talk to.
//
// **Shorter than /tags' day and equal to /units' five minutes**, because this
// catalog is written to constantly: saving a Recipe upserts every Ingredient
// its lines name, so an import coins new rows routinely. Staleness is not
// harmless here either - a name missing from this list is a name the extractor
// does not know exists, which is how the near-duplicates migration 029 exists
// to undo get coined in the first place. The purge below is the real freshness
// mechanism; five minutes is what covers a purge that failed.
const ingredientsCacheControl = "public, max-age=0, s-maxage=300"

// IngredientsCacheTag is the Netlify cache tag attached to /ingredients
// responses, and the tag a Recipe write purges. Exported for the same reason
// UnitsCacheTag is: a purge naming a tag no response carries is a silent no-op.
//
// Purged strictly more often than `units` in practice. A save coins a Unit only
// when it names one the catalog has never seen, which is rare after the first
// few imports; it coins an Ingredient far more often, because ingredient names
// are open text and units are effectively a closed vocabulary.
const IngredientsCacheTag = "ingredients"

// IngredientsOutput is the response body for listing ingredients.
type IngredientsOutput struct {
	CacheControl string `header:"Cache-Control"`
	// See UnitsOutput for why this is Netlify's header rather than the
	// vendor-neutral Cache-Tag.
	NetlifyCacheTag string `header:"Netlify-Cache-Tag"`
	Body            []IngredientName
}

// withCachePolicy stamps this route's policy onto the response. See the same
// method on UnitsOutput for why it is a method rather than a field assignment.
func (o *IngredientsOutput) withCachePolicy() *IngredientsOutput {
	o.CacheControl = ingredientsCacheControl
	o.NetlifyCacheTag = IngredientsCacheTag
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
