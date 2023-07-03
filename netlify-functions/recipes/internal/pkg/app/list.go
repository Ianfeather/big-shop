package app

import (
	"encoding/json"
	"log"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"strconv"
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

func (a *App) getListHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)

	list, err := service.GetShoppingList(userID, a.db)

	if err != nil {
		http.Error(w, "Error Fetching Shopping List", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if err = encoder.Encode(list); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}

func (a *App) createListHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)

	recipeIDs := make([]string, 0)
	if err := json.NewDecoder(req.Body).Decode(&recipeIDs); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	recipes := make([]common.Recipe, 0)

	for i := 0; i < len(recipeIDs); i++ {
		id, err := strconv.Atoi(recipeIDs[i])
		if err != nil {
			http.Error(w, "Cannot parse recipe id", http.StatusBadRequest)
			return
		}
		recipe, err := service.GetRecipeByID(id, userID, a.db)
		if err != nil {
			http.Error(w, "Cannot get recipe", http.StatusInternalServerError)
			return
		}
		recipes = append(recipes, *recipe)
	}

	combinedIngredients := CombineIngredients(recipes)
	if err := service.RemoveIngredientListItems(userID, a.db); err != nil {
		log.Println("Cannot delete list items")
		http.Error(w, "Cannot delete list items", http.StatusInternalServerError)
		return
	}

	if len(combinedIngredients) > 0 {
		if err := service.AddIngredientListItems(userID, combinedIngredients, a.db); err != nil {
			log.Println("Cannot add list items")
			http.Error(w, "Cannot add list items", http.StatusInternalServerError)
			return
		}
	}

	list, err := service.GetShoppingList(userID, a.db)

	if err != nil {
		http.Error(w, "Cannot get extra list items", http.StatusInternalServerError)
		log.Println("Cannot get extra list items")
		return
	}

	encoder := json.NewEncoder(w)
	if err := encoder.Encode(list); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) addExtraListItem(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)

	var extraItem ListItem
	if err := json.NewDecoder(req.Body).Decode(&extraItem); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if extraItem.Name == "" {
		http.Error(w, "Missing item name", http.StatusBadRequest)
		return
	}

	if err := service.AddExtraListItem(userID, extraItem.Name, extraItem.IsBought, a.db); err != nil {
		http.Error(w, "Cannot add list items", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if err := encoder.Encode(&common.SimpleResponse{Status: "ok"}); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) buyListItemHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)

	var listItem ListItem
	if err := json.NewDecoder(req.Body).Decode(&listItem); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if listItem.Name == "" {
		http.Error(w, "Missing item name", http.StatusBadRequest)
		return
	}

	if err := service.BuyListItem(userID, listItem.Name, listItem.IsBought, a.db); err != nil {
		http.Error(w, "Error marking item as bought", http.StatusInternalServerError)
		return
	}

	list, err := service.GetShoppingList(userID, a.db)
	if err != nil {
		http.Error(w, "Error getting shopping list", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if err := encoder.Encode(list); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) clearListHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	if err := service.RemoveAllListItems(userID, a.db); err != nil {
		http.Error(w, "Error removing list items", http.StatusInternalServerError)
		return
	}

	response := &common.ShoppingList{}
	encoder := json.NewEncoder(w)
	if err := encoder.Encode(response); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}
