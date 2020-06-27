package app

import (
	"big-shop/go-src/internal/pkg/service"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
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

	err = encoder.Encode(ingredients)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}
