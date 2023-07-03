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

// ShoppingList contains the data model for a user's list
type ShoppingList struct {
	Recipes     []string                   `json:"recipes"`
	Ingredients map[string]*ListIngredient `json:"ingredients"`
	Extras      map[string]*ListIngredient `json:"extras"`
}

// Ingredient contains ingredient fields
type Ingredient struct {
	Name       string `json:"name"`
	Unit       string `json:"unit"`
	Quantity   string `json:"quantity"`
	Department string `json:"department"`
}

// Recipe contains recipe fields
type Recipe struct {
	Name        string       `json:"name"`
	ID          int          `json:"id"`
	RemoteURL   string       `json:"remoteUrl"`
	Notes       string       `json:"notes"`
	Ingredients []Ingredient `json:"ingredients"`
}

// ListIngredient is a subset of shopping List
type ListIngredient struct {
	Unit       string  `json:"unit"`
	Quantity   float64 `json:"quantity"`
	IsBought   bool    `json:"isBought"`
	RecipeID   int     `json:"recipe_id"`
	Department string  `json:"department"`
}

// User object
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Account holds accounts and users
type Account struct {
	ID    int    `json:"id"`
	Users []User `json:"users`
}

// Invite holds information about account collaboration invites
type Invite struct {
	Token         string `json:"token"`
	AccountHolder string `json:"account_holder"`
}
