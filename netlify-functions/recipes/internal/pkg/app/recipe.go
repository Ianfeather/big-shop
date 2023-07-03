package app

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"strconv"

	"github.com/gorilla/mux"
)

func (a *App) recipeHandlerBySlug(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	slug := mux.Vars(req)["slug"]
	recipe, err := service.GetRecipeBySlug(slug, userID, a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Recipe not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to parse recipe from db", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if encoder.Encode(recipe); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) recipeHandlerByID(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	id, err := strconv.Atoi(mux.Vars(req)["id"])

	if err != nil {
		http.Error(w, "Failed to parse id", http.StatusBadRequest)
		return
	}

	recipe, err := service.GetRecipeByID(id, userID, a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Recipe not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to parse recipe from db", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	if err = encoder.Encode(recipe); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) addRecipeHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	recipe := common.Recipe{}

	if err := json.NewDecoder(req.Body).Decode(&recipe); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if err := service.AddRecipe(recipe, userID, a.db); err != nil {
		http.Error(w, "could not insert ingredients", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	encoder := json.NewEncoder(w)
	if err := encoder.Encode("ok"); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) editRecipeHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	recipe := common.Recipe{}
	encoder := json.NewEncoder(w)

	if err := json.NewDecoder(req.Body).Decode(&recipe); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if recipe.ID == 0 {
		http.Error(w, "Error: missing id", http.StatusBadRequest)
		return
	}

	if err := service.EditRecipe(recipe, userID, a.db); err != nil {
		http.Error(w, "could not update recipe", http.StatusInternalServerError)
		return
	}

	if err := encoder.Encode("ok"); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) deleteRecipeHandler(w http.ResponseWriter, req *http.Request) {
	userID := req.Context().Value(contextKey("userID")).(string)
	recipe := common.Recipe{}
	encoder := json.NewEncoder(w)
	if err := json.NewDecoder(req.Body).Decode(&recipe); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	if recipe.ID == 0 {
		http.Error(w, "Error: missing id", http.StatusBadRequest)
		return
	}

	if err := service.DeleteRecipe(recipe, userID, a.db); err != nil {
		http.Error(w, "could not delete recipe", http.StatusInternalServerError)
		return
	}

	if err := encoder.Encode("ok"); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}
