package common

import "database/sql"

// Env is passed into our application
type Env struct {
	DB *sql.DB
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
	Ingredients []Ingredient `json:"ingredients"`
}
