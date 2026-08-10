package app

import (
	"context"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/telemetry"

	"github.com/danielgtaylor/huma/v2"
)

// ListItem is used for updating items in the DB
type ListItem struct {
	IsBought bool
	Name     string
}

// ShoppingListOutput is the response body for the shopping list.
type ShoppingListOutput struct {
	Body common.ShoppingList
}

// CreateListInput is the recipe IDs to (re)generate the shopping list from.
type CreateListInput struct {
	Body []string
}

// ListItemInput is a single list item update (extra item, or buy/unbuy).
type ListItemInput struct {
	Body ListItem
}

// ShoppingListHistoryOutput is the response body for shopping list history.
type ShoppingListHistoryOutput struct {
	Body struct {
		RecentRecipes   []int `json:"recent_recipes"`
		FavoriteRecipes []int `json:"favorite_recipes"`
	}
}

func (a *App) getList(ctx context.Context, _ *struct{}) (*ShoppingListOutput, error) {
	caller := callerFrom(ctx)

	list, err := service.GetShoppingList(ctx, caller, a.db)
	if err != nil {
		return nil, huma.Error500InternalServerError("Error Fetching Shopping List")
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) createList(ctx context.Context, input *CreateListInput) (*ShoppingListOutput, error) {
	caller := callerFrom(ctx)
	recipeIDs := input.Body

	list, err := service.GenerateShoppingList(ctx, recipeIDs, caller, a.db)

	if err != nil {
		if err == service.ErrInvalidRecipeID {
			return nil, huma.Error400BadRequest("Cannot parse recipe id")
		}
		return nil, fail(ctx, huma.Error500InternalServerError("Cannot generate shopping list"), err)
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) addExtraListItem(ctx context.Context, input *ListItemInput) (*StatusOutput, error) {
	caller := callerFrom(ctx)
	extraItem := input.Body

	if extraItem.Name == "" {
		return nil, huma.Error400BadRequest("Missing item name")
	}

	if err := service.AddExtraListItem(ctx, caller, extraItem.Name, extraItem.IsBought, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Cannot add list items")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) buyListItem(ctx context.Context, input *ListItemInput) (*ShoppingListOutput, error) {
	caller := callerFrom(ctx)
	listItem := input.Body

	if listItem.Name == "" {
		return nil, huma.Error400BadRequest("Missing item name")
	}

	if err := service.BuyListItem(ctx, caller, listItem.Name, listItem.IsBought, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Error marking item as bought")
	}

	list, err := service.GetShoppingList(ctx, caller, a.db)
	if err != nil {
		return nil, huma.Error500InternalServerError("Error getting shopping list")
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) clearList(ctx context.Context, _ *struct{}) (*ShoppingListOutput, error) {
	caller := callerFrom(ctx)

	if err := service.RemoveAllListItems(ctx, caller, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Error removing list items")
	}

	// Log clear event for meal planning intelligence
	if logErr := service.LogShoppingListClearEvent(ctx, caller, a.db); logErr != nil {
		// Recorded, not returned: clearing the list succeeded, and failing the
		// request because its history row did not get written would be worse
		// than losing the row.
		telemetry.RecordWarning(ctx, "log shopping list clear", logErr)
	}

	return &ShoppingListOutput{Body: common.ShoppingList{}}, nil
}

func (a *App) getShoppingListHistory(ctx context.Context, _ *struct{}) (*ShoppingListHistoryOutput, error) {
	caller := callerFrom(ctx)

	recentRecipes, err := service.GetRecentRecipeUsage(ctx, caller, 30, 10, a.db)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error getting recent recipes"), err)
	}

	favoriteRecipes, err := service.GetFavoriteRecipes(ctx, caller, 10, a.db)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error getting favorite recipes"), err)
	}

	resp := &ShoppingListHistoryOutput{}
	resp.Body.RecentRecipes = recentRecipes
	resp.Body.FavoriteRecipes = favoriteRecipes
	return resp, nil
}

func (a *App) registerListRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "get-shopping-list",
		Method:      http.MethodGet,
		Path:        "/shopping-list",
		Summary:     "Get the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.getList)

	register(api, huma.Operation{
		OperationID: "create-shopping-list",
		Method:      http.MethodPost,
		Path:        "/shopping-list",
		Summary:     "Generate the shopping list from a set of recipes",
		Description: "Combines Ingredient Lines from the given Recipe IDs into the shopping list, preserving already-bought state for surviving items.",
		Tags:        []string{"Shopping List"},
	}, a.createList)

	register(api, huma.Operation{
		OperationID: "buy-shopping-list-item",
		Method:      http.MethodPatch,
		Path:        "/shopping-list/buy",
		Summary:     "Mark a shopping list item as bought/unbought",
		Tags:        []string{"Shopping List"},
	}, a.buyListItem)

	register(api, huma.Operation{
		OperationID: "add-extra-list-item",
		Method:      http.MethodPost,
		Path:        "/shopping-list/extra",
		Summary:     "Add an extra (non-recipe) item to the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.addExtraListItem)

	register(api, huma.Operation{
		OperationID: "clear-shopping-list",
		Method:      http.MethodDelete,
		Path:        "/shopping-list/clear",
		Summary:     "Clear the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.clearList)

	register(api, huma.Operation{
		OperationID: "get-shopping-list-history",
		Method:      http.MethodGet,
		Path:        "/shopping-list/history",
		Summary:     "Get shopping list history",
		Description: "Returns recently-used and favorite Recipe IDs, used for meal planning suggestions.",
		Tags:        []string{"Shopping List"},
	}, a.getShoppingListHistory)
}
