package service

import (
	"big-shop/go-src/internal/pkg/common"

	"database/sql"
	"fmt"
)

func getIngredientsByRecipeID(id int, db *sql.DB) ([]common.Ingredient, error) {
	ingredientQuery := "SELECT ingredient.name as name, unit.name as unit, quantity FROM part INNER JOIN ingredient on ingredient_id = ingredient.id INNER JOIN unit on unit_id = unit.id WHERE recipe_id = %d;"
	results, err := db.Query(fmt.Sprintf(ingredientQuery, id))

	ingredients := make([]common.Ingredient, 0)

	for results.Next() {
		ingredient := common.Ingredient{}
		err = results.Scan(&ingredient.Name, &ingredient.Unit, &ingredient.Quantity)
		if err != nil {
			return nil, err
		}
		ingredients = append(ingredients, ingredient)
	}
	return ingredients, nil
}

// GetRecipeBySlug fetches a recipe from the database by Slug
func GetRecipeBySlug(slug string, db *sql.DB) (r *common.Recipe, e error) {
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}}
	recipeQuery := "SELECT id, name FROM recipe where slug='%s'"

	err := db.QueryRow(fmt.Sprintf(recipeQuery, slug)).Scan(&recipe.ID, &recipe.Name)

	if err != nil {
		return nil, err
	}

	ingredients, err := getIngredientsByRecipeID(recipe.ID, db)

	if err != nil {
		return nil, err
	}

	recipe.Ingredients = ingredients

	return recipe, nil
}

// GetRecipeByID fetches a recipe from the database by ID
func GetRecipeByID(id int, db *sql.DB) (r *common.Recipe, e error) {
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}}
	recipeQuery := "SELECT id, name FROM recipe where id='%d'"

	err := db.QueryRow(fmt.Sprintf(recipeQuery, id)).Scan(&recipe.ID, &recipe.Name)

	if err != nil {
		return nil, err
	}

	ingredients, err := getIngredientsByRecipeID(id, db)
	// todo: get recipe name

	if err != nil {
		fmt.Println(err)
		return nil, err
	}

	recipe.Ingredients = ingredients
	return recipe, nil
}
