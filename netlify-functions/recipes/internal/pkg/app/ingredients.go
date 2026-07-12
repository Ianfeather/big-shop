package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
)

func (a *App) ingredientsHandler(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	ingredients, err := service.GetAllIngredients(a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Ingredients not found", http.StatusNotFound)
			err = encoder.Encode(make([]string, 0))
			return
		}
		fmt.Println(err)
		http.Error(w, "Failed to get ingredients from db", http.StatusInternalServerError)
		return
	}

	if err = encoder.Encode(ingredients); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

// updateIngredientHandler lets the ingredient audit page
// (pages/ingredients/audit.js) manually set/correct an ingredient's
// preferred unit and average item weight.
func (a *App) updateIngredientHandler(w http.ResponseWriter, req *http.Request) {
	var update service.IngredientClassificationUpdate
	if err := json.NewDecoder(req.Body).Decode(&update); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if update.ID == 0 {
		http.Error(w, "Missing ingredient id", http.StatusBadRequest)
		return
	}

	if err := service.UpdateIngredientClassification(update, a.db); err != nil {
		fmt.Println(err)
		http.Error(w, "Failed to update ingredient", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if err := encoder.Encode(&common.SimpleResponse{Status: "ok"}); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}
