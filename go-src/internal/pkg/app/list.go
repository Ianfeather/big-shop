package app

import (
	"big-shop/go-src/internal/pkg/common"
	"big-shop/go-src/internal/pkg/service"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// ResponseObject is the json response
type ResponseObject struct {
	Recipes []common.Recipe        `json:"recipes"`
	List    map[string]*Ingredient `json:"list"`
}

// Ingredient is a subset of shopping List
type Ingredient struct {
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
}

// CombineIngredients creates combined values/units
func CombineIngredients(r []common.Recipe) map[string]*Ingredient {
	parentUnit := map[string]string{
		"gram":       "kilogram",
		"millilitre": "litre",
	}
	childUnit := map[string]string{
		"kilogram": "gram",
		"litre":    "millilitre",
	}

	ingredientList := make(map[string]*Ingredient)
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
					newIngredient := Ingredient{
						Unit:     ingredient.Unit,
						Quantity: q,
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
	qs := req.URL.Query()
	recipeIDs := strings.Split(qs.Get("recipes"), ",")

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

	response.List = CombineIngredients(response.Recipes)

	encoder := json.NewEncoder(w)
	err := encoder.Encode(response)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}

}
