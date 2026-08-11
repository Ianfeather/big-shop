package service

import (
	"context"
	"database/sql"
	"log"

	"recipes/internal/pkg/telemetry"
)

// Recipe is a lightweight recipe type w/o ingredients
type Recipe struct {
	Name string   `json:"name"`
	ID   int      `json:"id"`
	Tags []string `json:"tags"`
}

// GetAllRecipes returns all recipes in the recipe table.
//
// Takes a context so its query can be attributed to the request that caused it:
// otelsql emits a span only for a call whose context already carries one (see
// main.go's SpanFilter). Every function in this package now does the same; this
// one was simply first.
func GetAllRecipes(ctx context.Context, db *sql.DB, userID string) ([]Recipe, error) {
	accountID, err := GetAccountID(ctx, db, userID)

	if err != nil {
		log.Println("Error getting account ID")
		return nil, err
	}

	// Recorded here because here is where it becomes known - the handler is
	// given a user, not an Account. On the span only, never on a metric:
	// ADR-0008 §2.
	telemetry.SetAccountID(ctx, accountID)

	recipesQuery := `
		SELECT recipe.id, name, tag_name FROM recipe
			LEFT JOIN recipe_tag on recipe.id = recipe_tag.recipe_id
			WHERE account_id = ?
			ORDER BY lower(recipe.name);
	`
	results, err := db.QueryContext(ctx, recipesQuery, accountID)

	if err != nil {
		log.Println("Error querying recipes")
		return nil, err
	}
	defer results.Close()

	recipes := []Recipe{}

	for results.Next() {
		r := Recipe{Tags: []string{}}
		var tag sql.NullString
		err = results.Scan(&r.ID, &r.Name, &tag)
		if err != nil {
			return nil, err
		}

		if len(recipes) > 0 {
			if r.ID == recipes[len(recipes)-1].ID {
				recipes[len(recipes)-1].Tags = append(recipes[len(recipes)-1].Tags, tag.String)
				continue
			}
		}

		if tag.Valid {
			r.Tags = []string{tag.String}
		}
		recipes = append(recipes, r)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return recipes, nil
}
