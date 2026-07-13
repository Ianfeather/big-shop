package app

import (
	"context"
	"database/sql"
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

func (a *App) getRecipe(ctx context.Context, input *RecipeByIDInput) (*RecipeOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	var recipe *common.Recipe
	var err error
	if id, convErr := strconv.Atoi(input.ID); convErr == nil {
		recipe, err = service.GetRecipeByID(id, userID, a.db)
	} else {
		recipe, err = service.GetRecipeBySlug(input.ID, userID, a.db)
	}

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, huma.Error404NotFound("Recipe not found")
		}
		return nil, huma.Error500InternalServerError("Failed to parse recipe from db")
	}

	return &RecipeOutput{Body: *recipe}, nil
}

func (a *App) addRecipe(ctx context.Context, input *RecipeInput) (*StatusOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if err := service.AddRecipe(input.Body, userID, a.db); err != nil {
		return nil, huma.Error500InternalServerError("could not insert ingredients")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) editRecipe(ctx context.Context, input *RecipeInput) (*StatusOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if input.Body.ID == 0 {
		return nil, huma.Error400BadRequest("Error: missing id")
	}

	if err := service.EditRecipe(input.Body, userID, a.db); err != nil {
		return nil, huma.Error500InternalServerError("could not update recipe")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) deleteRecipe(ctx context.Context, input *DeleteRecipeInput) (*StatusOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if input.Body.ID == 0 {
		return nil, huma.Error400BadRequest("Error: missing id")
	}

	if err := service.DeleteRecipe(common.Recipe{ID: input.Body.ID}, userID, a.db); err != nil {
		return nil, huma.Error500InternalServerError("could not delete recipe")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) registerRecipeRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-recipe",
		Method:      http.MethodGet,
		Path:        "/recipe/{id}",
		Summary:     "Get a recipe by ID or slug",
		Description: "Looks a Recipe up by numeric ID if `id` parses as an integer, otherwise by its URL slug.",
		Tags:        []string{"Recipes"},
	}, a.getRecipe)

	huma.Register(api, huma.Operation{
		OperationID:   "add-recipe",
		Method:        http.MethodPost,
		Path:          "/recipe",
		Summary:       "Add a recipe",
		Tags:          []string{"Recipes"},
		DefaultStatus: http.StatusCreated,
	}, a.addRecipe)

	huma.Register(api, huma.Operation{
		OperationID: "edit-recipe",
		Method:      http.MethodPut,
		Path:        "/recipe",
		Summary:     "Edit a recipe",
		Tags:        []string{"Recipes"},
	}, a.editRecipe)

	huma.Register(api, huma.Operation{
		OperationID: "delete-recipe",
		Method:      http.MethodDelete,
		Path:        "/recipe",
		Summary:     "Delete a recipe",
		Tags:        []string{"Recipes"},
	}, a.deleteRecipe)
}
