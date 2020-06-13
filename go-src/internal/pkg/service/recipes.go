package service

import (
	"database/sql"
)

// Recipe is a lightweight recipe type w/o ingredients
type Recipe struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

// GetAllRecipes returns all recipes in the recipe table
func GetAllRecipes(db *sql.DB) ([]Recipe, error) {
	recipesQuery := "SELECT id, name FROM recipe;"
	results, err := db.Query(recipesQuery)

	recipes := make([]Recipe, 0)

	for results.Next() {
		r := Recipe{}
		err = results.Scan(&r.ID, &r.Name)
		if err != nil {
			return nil, err
		}
		recipes = append(recipes, r)
	}
	return recipes, nil
}
