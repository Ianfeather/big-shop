package app

import (
	"context"
	"log"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
)

// ListItem is used for updating items in the DB
type ListItem struct {
	IsBought bool
	Name     string
}

// CombineIngredients creates combined values/units
func CombineIngredients(r []common.Recipe) map[string]*common.ListIngredient {
	parentUnit := map[string]string{
		"gram":       "kilogram",
		"millilitre": "litre",
	}
	childUnit := map[string]string{
		"kilogram": "gram",
		"litre":    "millilitre",
	}

	ingredientList := make(map[string]*common.ListIngredient)
	for _, recipe := range r {
		for _, ingredient := range recipe.Ingredients {
			if q, err := strconv.ParseFloat(ingredient.Quantity, 64); err == nil {
				if childUnit, isParentUnit := childUnit[ingredient.Unit]; isParentUnit {
					q = q * 1000
					ingredient.Unit = childUnit
				}
				if existingIngredient, exists := ingredientList[ingredient.Name]; exists {
					existingIngredient.Quantity = existingIngredient.Quantity + q
				} else {
					newIngredient := common.ListIngredient{
						Unit:       ingredient.Unit,
						Quantity:   q,
						IsBought:   false,
						Department: ingredient.Department,
						RecipeID:   recipe.ID,
					}
					ingredientList[ingredient.Name] = &newIngredient
				}
			}
		}
	}

	for key, value := range ingredientList {
		if value.Quantity < 1000 {
			continue
		}
		if parentUnit, exists := parentUnit[value.Unit]; exists {
			ingredientList[key].Unit = parentUnit
			ingredientList[key].Quantity = ingredientList[key].Quantity / 1000
		}
	}

	return ingredientList
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
	userID := ctx.Value(contextKey("userID")).(string)

	list, err := service.GetShoppingList(userID, a.db)
	if err != nil {
		return nil, huma.Error500InternalServerError("Error Fetching Shopping List")
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) createList(ctx context.Context, input *CreateListInput) (*ShoppingListOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	recipeIDs := input.Body

	recipes := make([]common.Recipe, 0)
	for i := 0; i < len(recipeIDs); i++ {
		id, err := strconv.Atoi(recipeIDs[i])
		if err != nil {
			return nil, huma.Error400BadRequest("Cannot parse recipe id")
		}
		recipe, err := service.GetRecipeByID(id, userID, a.db)
		if err != nil {
			return nil, huma.Error500InternalServerError("Cannot get recipe")
		}
		recipes = append(recipes, *recipe)
	}

	combinedIngredients := CombineIngredients(recipes)
	if err := service.RemoveIngredientListItems(userID, a.db); err != nil {
		log.Println("Cannot delete list items")
		return nil, huma.Error500InternalServerError("Cannot delete list items")
	}

	if len(combinedIngredients) > 0 {
		if err := service.AddIngredientListItems(userID, combinedIngredients, a.db); err != nil {
			log.Println("Cannot add list items")
			return nil, huma.Error500InternalServerError("Cannot add list items")
		}
	}

	// Log shopping list history for meal planning intelligence
	if intRecipeIDs, err := service.GetRecipeIDsFromStrings(recipeIDs); err == nil {
		if logErr := service.LogShoppingListEvent(userID, "add_recipe", intRecipeIDs, a.db); logErr != nil {
			// Log error but don't fail the main operation
			log.Printf("Failed to log shopping list history: %v", logErr)
		}
	}

	list, err := service.GetShoppingList(userID, a.db)
	if err != nil {
		log.Println("Cannot get extra list items")
		return nil, huma.Error500InternalServerError("Cannot get extra list items")
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) addExtraListItem(ctx context.Context, input *ListItemInput) (*StatusOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	extraItem := input.Body

	if extraItem.Name == "" {
		return nil, huma.Error400BadRequest("Missing item name")
	}

	if err := service.AddExtraListItem(userID, extraItem.Name, extraItem.IsBought, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Cannot add list items")
	}

	return &StatusOutput{Body: common.SimpleResponse{Status: "ok"}}, nil
}

func (a *App) buyListItem(ctx context.Context, input *ListItemInput) (*ShoppingListOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	listItem := input.Body

	if listItem.Name == "" {
		return nil, huma.Error400BadRequest("Missing item name")
	}

	if err := service.BuyListItem(userID, listItem.Name, listItem.IsBought, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Error marking item as bought")
	}

	list, err := service.GetShoppingList(userID, a.db)
	if err != nil {
		return nil, huma.Error500InternalServerError("Error getting shopping list")
	}

	return &ShoppingListOutput{Body: *list}, nil
}

func (a *App) clearList(ctx context.Context, _ *struct{}) (*ShoppingListOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if err := service.RemoveAllListItems(userID, a.db); err != nil {
		return nil, huma.Error500InternalServerError("Error removing list items")
	}

	// Log clear event for meal planning intelligence
	if logErr := service.LogShoppingListClearEvent(userID, a.db); logErr != nil {
		// Log error but don't fail the main operation
		log.Printf("Failed to log shopping list clear: %v", logErr)
	}

	return &ShoppingListOutput{Body: common.ShoppingList{}}, nil
}

func (a *App) getShoppingListHistory(ctx context.Context, _ *struct{}) (*ShoppingListHistoryOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	recentRecipes, err := service.GetRecentRecipeUsage(userID, 30, 10, a.db)
	if err != nil {
		log.Printf("Error getting recent recipes: %v", err)
		return nil, huma.Error500InternalServerError("Error getting recent recipes")
	}

	favoriteRecipes, err := service.GetFavoriteRecipes(userID, 10, a.db)
	if err != nil {
		log.Printf("Error getting favorite recipes: %v", err)
		return nil, huma.Error500InternalServerError("Error getting favorite recipes")
	}

	resp := &ShoppingListHistoryOutput{}
	resp.Body.RecentRecipes = recentRecipes
	resp.Body.FavoriteRecipes = favoriteRecipes
	return resp, nil
}

func (a *App) registerListRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-shopping-list",
		Method:      http.MethodGet,
		Path:        "/shopping-list",
		Summary:     "Get the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.getList)

	huma.Register(api, huma.Operation{
		OperationID: "create-shopping-list",
		Method:      http.MethodPost,
		Path:        "/shopping-list",
		Summary:     "Generate the shopping list from a set of recipes",
		Description: "Combines Ingredient Lines from the given Recipe IDs into the shopping list, preserving already-bought state for surviving items.",
		Tags:        []string{"Shopping List"},
	}, a.createList)

	huma.Register(api, huma.Operation{
		OperationID: "buy-shopping-list-item",
		Method:      http.MethodPatch,
		Path:        "/shopping-list/buy",
		Summary:     "Mark a shopping list item as bought/unbought",
		Tags:        []string{"Shopping List"},
	}, a.buyListItem)

	huma.Register(api, huma.Operation{
		OperationID: "add-extra-list-item",
		Method:      http.MethodPost,
		Path:        "/shopping-list/extra",
		Summary:     "Add an extra (non-recipe) item to the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.addExtraListItem)

	huma.Register(api, huma.Operation{
		OperationID: "clear-shopping-list",
		Method:      http.MethodDelete,
		Path:        "/shopping-list/clear",
		Summary:     "Clear the shopping list",
		Tags:        []string{"Shopping List"},
	}, a.clearList)

	huma.Register(api, huma.Operation{
		OperationID: "get-shopping-list-history",
		Method:      http.MethodGet,
		Path:        "/shopping-list/history",
		Summary:     "Get shopping list history",
		Description: "Returns recently-used and favorite Recipe IDs, used for meal planning suggestions.",
		Tags:        []string{"Shopping List"},
	}, a.getShoppingListHistory)
}
