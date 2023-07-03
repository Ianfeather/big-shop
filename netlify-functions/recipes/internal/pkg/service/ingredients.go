package service

import (
	"database/sql"
)

// Ingredient is a lightweight ingredient type
type Ingredient struct {
	Name string `json:"name"`
}

// GetAllIngredients returns all recipes in the recipe table
func GetAllIngredients(db *sql.DB) ([]Ingredient, error) {
	query := "SELECT name FROM ingredient ORDER BY lower(name);"
	results, err := db.Query(query)

	ingredients := make([]Ingredient, 0)

	for results.Next() {
		r := Ingredient{}
		err = results.Scan(&r.Name)
		if err != nil {
			return nil, err
		}
		ingredients = append(ingredients, r)
	}
	return ingredients, nil
}
