package app

import (
	"encoding/json"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"strconv"

	"github.com/gorilla/mux"
)

func (a *App) getStepsHandler(w http.ResponseWriter, req *http.Request) {
	id, err := strconv.Atoi(mux.Vars(req)["id"])
	if err != nil {
		http.Error(w, "Failed to parse id", http.StatusBadRequest)
		return
	}

	steps, err := service.GetStepsByRecipeID(id, a.db)
	if err != nil {
		http.Error(w, "Failed to fetch steps", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(steps); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) saveStepsHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	id, err := strconv.Atoi(mux.Vars(req)["id"])
	if err != nil {
		http.Error(w, "Failed to parse id", http.StatusBadRequest)
		return
	}

	// Verify the recipe belongs to this user's account before allowing writes
	accountID, err := service.GetAccountID(a.db, userID)
	if err != nil {
		http.Error(w, "Failed to verify account", http.StatusInternalServerError)
		return
	}

	var recipeID string
	if err := a.db.QueryRow("SELECT id FROM recipe WHERE id = ? AND account_id = ?", id, accountID).Scan(&recipeID); err != nil {
		http.Error(w, "Recipe not found", http.StatusNotFound)
		return
	}

	var steps []common.Step
	if err := json.NewDecoder(req.Body).Decode(&steps); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if err := service.SaveSteps(id, steps, a.db); err != nil {
		http.Error(w, "Failed to save steps", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode("ok")
}
