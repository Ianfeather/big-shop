package common

import "database/sql"

// Env is passed into our application
type Env struct {
	DB *sql.DB
}

// SimpleResponse only returns a status message
type SimpleResponse struct {
	Status string `json:"status"`
}

// Ingredient contains ingredient fields
type Ingredient struct {
	Name     string `json:"name"`
	Unit     string `json:"unit"`
	Quantity string `json:"quantity"`
}

// Recipe contains recipe fields
type Recipe struct {
	Name        string       `json:"name"`
	ID          int          `json:"id"`
	RemoteURL   string       `json:"remoteUrl"`
	Ingredients []Ingredient `json:"ingredients"`
}

// ListIngredient is a subset of shopping List
type ListIngredient struct {
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
	IsBought bool    `json:"isBought"`
	RecipeID int     `json:"recipe_id"`
}
