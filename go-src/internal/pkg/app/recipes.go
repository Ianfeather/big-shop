package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
)

func (a *App) recipesHandler(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	recipes, err := service.GetAllRecipes(a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Recipe not found", http.StatusNotFound)
			err = encoder.Encode(make([]string, 0))
			return
		}
		fmt.Println(err)
		http.Error(w, "Failed to get recipes from db", http.StatusInternalServerError)
		return
	}

	err = encoder.Encode(recipes)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}
