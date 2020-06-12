package app

import (
	"big-shop/go-src/internal/pkg/common"
	"big-shop/go-src/internal/pkg/service"

	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
)

func (a *App) recipeHandler(w http.ResponseWriter, req *http.Request) {
	slug := mux.Vars(req)["slug"]

	recipe, err := service.GetRecipeBySlug(slug, a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Recipe not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to parse recipe from db", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	err = encoder.Encode(recipe)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
		return
	}
}

func (a *App) addRecipeHandler(w http.ResponseWriter, req *http.Request) {
	recipe := common.Recipe{}
	err := json.NewDecoder(req.Body).Decode(&recipe)

	if err != nil {
		w.Write([]byte("Error decoding json body"))
	}

	_, err = a.db.Query(fmt.Sprintf("INSERT INTO recipe (name, slug) VALUES ('%s', '%s')", recipe.Name, common.Slugify(recipe.Name)))

	if err != nil {
		fmt.Println("could not insert recipe")
		fmt.Println(err.Error())
	}

	fmt.Printf("Stored %s", recipe.Name)
}
