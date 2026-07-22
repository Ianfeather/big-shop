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
// omitempty on Department: the frontend submits new/edited Ingredient Lines
// as {name, quantity, unit} only - Department is resolved server-side from
// the ingredient_department join table, never supplied by the client.
type Ingredient struct {
	Name       string `json:"name"`
	Unit       string `json:"unit"`
	Quantity   string `json:"quantity"`
	Department string `json:"department,omitempty"`
}

// Tag contains tag fields
type Tag struct {
	Name string `json:"name"`
}

// Recipe contains recipe fields
type Recipe struct {
	Name string `json:"name"`
	// omitempty: a new Recipe (POST /recipe) has no ID yet - the DB assigns
	// one on insert. Huma infers required-ness from JSON tags, so without
	// this a create request without an `id` would fail validation.
	ID          int          `json:"id,omitempty"`
	RemoteURL   string       `json:"remoteUrl"`
	Notes       string       `json:"notes"`
	Method      string       `json:"method"`
	Ingredients []Ingredient `json:"ingredients"`
	Tags        []string     `json:"tags"`
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
// omitempty on ID/Name: a new user (POST /user) and an invite (POST
// /invite) are sent by the frontend with only a subset of these fields -
// see the ID comment on Recipe above for why that matters to Huma.
// omitempty on Onboarded: it's server-managed and never sent by the client
// as input (POST /user, POST /invite), so without omitempty Huma would mark
// it required on those request bodies. On output, "false" and "absent" are
// equivalent here since the frontend only ever checks it for truthiness.
type User struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Email     string `json:"email"`
	Onboarded bool   `json:"onboarded,omitempty"`
}

// Account holds accounts and users
type Account struct {
	ID    int    `json:"id"`
	Users []User `json:"users"`
}

// Invite holds information about account collaboration invites
type Invite struct {
	Token         string `json:"token"`
	AccountHolder string `json:"account_holder"`
}
