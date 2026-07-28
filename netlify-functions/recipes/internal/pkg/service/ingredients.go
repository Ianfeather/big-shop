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
	// err was previously never checked here, so a failed query dereferenced a
	// nil *sql.Rows on the next line and panicked instead of returning.
	if err != nil {
		return nil, err
	}
	defer results.Close()

	ingredients := make([]Ingredient, 0)

	for results.Next() {
		r := Ingredient{}
		if err := results.Scan(&r.Name); err != nil {
			return nil, err
		}
		ingredients = append(ingredients, r)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return ingredients, nil
}
