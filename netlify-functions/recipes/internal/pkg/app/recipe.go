package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
)

// RecipeByIDInput identifies a recipe by numeric ID or URL slug - both are
// accepted on the same route since gorilla/mux previously disambiguated
// them via two routes with mutually-exclusive path-segment regexes
// (`[0-9]+` vs `[a-zA-Z-]+`), which Huma's OpenAPI path templates can't
// represent (the regex leaks verbatim into the generated spec's path key).
type RecipeByIDInput struct {
	ID string `path:"id" doc:"Numeric Recipe ID or URL slug"`
}

// RecipeOutput is the response body for a single recipe.
type RecipeOutput struct {
	Body common.Recipe
}

// RecipeInput carries a full recipe body, used for add/edit.
type RecipeInput struct {
	Body common.Recipe
}

// DeleteRecipeInput carries just the ID of the recipe to delete - the
// frontend only ever sends `{id}` for a delete, unlike add/edit which send
// the full Recipe body.
type DeleteRecipeInput struct {
	Body struct {
		ID int `json:"id"`
	}
}

// StatusOutput is a simple ok/error status response.
type StatusOutput struct {
	Body common.SimpleResponse
}

// AddRecipeOutput carries the new Recipe's ID alongside the status, so the
// frontend can redirect straight to its detail page after a create.
type AddRecipeOutput struct {
	Body common.CreatedResponse
}

func (a *App) getRecipe(ctx context.Context, input *RecipeByIDInput) (*RecipeOutput, error) {
	caller := callerFrom(ctx)

	var recipe *common.Recipe
	var err error
	if id, convErr := strconv.Atoi(input.ID); convErr == nil {
		recipe, err = service.GetRecipeByID(ctx, id, caller, a.db)
	} else {
		recipe, err = service.GetRecipeBySlug(ctx, input.ID, caller, a.db)
	}

	if err != nil {
		// errors.Is, not ==: the service layer wraps its errors now, and a
		// sentinel compared by identity stops matching the moment anything in
		// the call chain adds context to it.
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("Recipe not found")
		}
		return nil, huma.Error500InternalServerError("Failed to parse recipe from db")
	}

	return &RecipeOutput{Body: *recipe}, nil
}

func (a *App) addRecipe(ctx context.Context, input *RecipeInput) (*AddRecipeOutput, error) {
	caller := callerFrom(ctx)

	id, err := service.AddRecipe(ctx, input.Body, caller, a.db)
	if err != nil {
		return nil, huma.Error500InternalServerError("could not insert ingredients")
	}

	a.purgeUnitsCache()

	return &AddRecipeOutput{Body: common.CreatedResponse{Status: "ok", ID: id}}, nil
}

func (a *App) editRecipe(ctx context.Context, input *RecipeInput) (*StatusOutput, error) {
	caller := callerFrom(ctx)

	if input.Body.ID == 0 {
		return nil, huma.Error400BadRequest("Error: missing id")
	}

	if err := service.EditRecipe(ctx, input.Body, caller, a.db); err != nil {
		return nil, huma.Error500InternalServerError("could not update recipe")
	}

	a.purgeUnitsCache()

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

// purgeUnitsCache invalidates both caches over the global catalogs: the /units
// response held at Netlify's edge, and the API's own in-process copy.
//
// Called after a Recipe create or edit because both run insertUnits and
// insertIngredients, which upsert every Unit and Ingredient the Recipe's lines
// reference - so either can coin a Unit ("bunch", arriving via an import) that
// the cached catalogs do not have - and then classifyNewIngredients, which
// writes Base Units, Display Units, pantry flags and Unit Sizes. Delete is
// deliberately not wired: it removes a Recipe's parts, never a Unit or an
// Ingredient, so there is nothing to invalidate and a purge there would only
// spend the rate limit.
//
// The two caches are cleared from **one** call site rather than two, on
// purpose. They hold the same data for different readers - the edge serves
// clients, the in-process copy serves this API's own combining logic - and a
// save that cleared one but not the other would leave the Shopping List
// combining against a catalog the client can already see is out of date. One
// place that knows the catalog changed, not two that have to stay in step.
//
// Returns nothing and is called for effect, after the write has already
// succeeded. It cannot fail the save: Purge dispatches in the background and
// swallows its own errors, Invalidate cannot fail, and if both did nothing at
// all the five-minute expiry on each is what makes that self-heal.
func (a *App) purgeUnitsCache() {
	a.purger.Purge(UnitsCacheTag)
	a.catalogs.Invalidate()
}

func (a *App) deleteRecipe(ctx context.Context, input *DeleteRecipeInput) (*StatusOutput, error) {
	caller := callerFrom(ctx)

	if input.Body.ID == 0 {
		return nil, huma.Error400BadRequest("Error: missing id")
	}

	if err := service.DeleteRecipe(ctx, common.Recipe{ID: input.Body.ID}, caller, a.db); err != nil {
		return nil, huma.Error500InternalServerError("could not delete recipe")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) registerRecipeRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "get-recipe",
		Method:      http.MethodGet,
		Path:        "/recipe/{id}",
		Summary:     "Get a recipe by ID or slug",
		Description: "Looks a Recipe up by numeric ID if `id` parses as an integer, otherwise by its URL slug.",
		Tags:        []string{"Recipes"},
	}, a.getRecipe)

	register(api, huma.Operation{
		OperationID:   "add-recipe",
		Method:        http.MethodPost,
		Path:          "/recipe",
		Summary:       "Add a recipe",
		Tags:          []string{"Recipes"},
		DefaultStatus: http.StatusCreated,
	}, a.addRecipe)

	register(api, huma.Operation{
		OperationID: "edit-recipe",
		Method:      http.MethodPut,
		Path:        "/recipe",
		Summary:     "Edit a recipe",
		Tags:        []string{"Recipes"},
	}, a.editRecipe)

	register(api, huma.Operation{
		OperationID: "delete-recipe",
		Method:      http.MethodDelete,
		Path:        "/recipe",
		Summary:     "Delete a recipe",
		Tags:        []string{"Recipes"},
	}, a.deleteRecipe)
}
