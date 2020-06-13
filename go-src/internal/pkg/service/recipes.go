package service

import (
	"big-shop/go-src/internal/pkg/common"

	"database/sql"
)

func getAllRecipes(db *sql.DB) ([]common.Recipe, error) {
	recipesQuery := "SELECT id, name FROM recipe;"
	results, err := db.Query(recipesQuery)

	recipes := make([]common.Recipe, 0)

	for results.Next() {
		r := common.Recipe{}
		err = results.Scan(&r.ID, &r.Name)
		if err != nil {
			return nil, err
		}
		recipes = append(recipes, r)
	}
	return recipes, nil
}
