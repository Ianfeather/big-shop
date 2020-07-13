package app

import (
	"big-shop/go-src/internal/pkg/common"
	"big-shop/go-src/internal/pkg/service"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// ResponseObject is the json response
type ResponseObject struct {
	Recipes     []common.Recipe                   `json:"recipes"`
	Ingredients map[string]*common.ListIngredient `json:"ingredients"`
	Extras      map[string]*common.ListIngredient `json:"extras"`
}

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
						Unit:     ingredient.Unit,
						Quantity: q,
						IsBought: false,
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

func (a *App) createListHandler(w http.ResponseWriter, req *http.Request) {
	// TODO: Identity
	userID := 1

	recipeIDs := make([]string, 0)
	err := json.NewDecoder(req.Body).Decode(&recipeIDs)

	if err != nil {
		w.Write([]byte("Error decoding json body"))
	}

	response := &ResponseObject{}

	for i := 0; i < len(recipeIDs); i++ {
		id, err := strconv.Atoi(recipeIDs[i])
		if err != nil {
			fmt.Println(err)
		}
		recipe, err := service.GetRecipeByID(id, a.db)
		if err != nil {
			fmt.Println(err)
		}
		response.Recipes = append(response.Recipes, *recipe)
	}

	combinedIngredients := CombineIngredients(response.Recipes)

	service.RemoveIngredientListItems(userID, a.db)
	service.AddIngredientListItems(userID, combinedIngredients, a.db)

	// Return the new items + extras
	response.Ingredients = combinedIngredients
	response.Extras, err = service.GetExtraListItems(userID, a.db)

	encoder := json.NewEncoder(w)
	err = encoder.Encode(response)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}

func (a *App) addExtraListItem(w http.ResponseWriter, req *http.Request) {
	userID := 1

	var extraItem ListItem
	err := json.NewDecoder(req.Body).Decode(&extraItem)

	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Error decoding json body"))
		return
	}

	if extraItem.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Missing item name"))
		return
	}

	err = service.AddExtraListItem(userID, extraItem.Name, extraItem.IsBought, a.db)
	encoder := json.NewEncoder(w)
	err = encoder.Encode(&common.SimpleResponse{Status: "ok"})
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}

func (a *App) buyListItemHandler(w http.ResponseWriter, req *http.Request) {
	userID := 1

	var listItem ListItem
	err := json.NewDecoder(req.Body).Decode(&listItem)

	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Error decoding json body"))
		return
	}

	if listItem.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Missing item name"))
		return
	}

	err = service.BuyListItem(userID, listItem.Name, listItem.IsBought, a.db)
	if err != nil {
		http.Error(w, "Error marking item as bought", http.StatusInternalServerError)
		return
	}
	encoder := json.NewEncoder(w)
	err = encoder.Encode(listItem)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}

func (a *App) clearListHandler(w http.ResponseWriter, req *http.Request) {
	userID := 1
	service.RemoveAllListItems(userID, a.db)

	response := &ResponseObject{}
	encoder := json.NewEncoder(w)
	err := encoder.Encode(response)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}
