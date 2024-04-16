package service

import (
	"recipes/internal/pkg/common"
	"strings"

	"database/sql"
	"fmt"
	"log"
)

func getIngredientsByRecipeID(id int, db *sql.DB) ([]common.Ingredient, error) {
	query := `
		SELECT
			ingredient.name as name,
			unit.name as unit,
			quantity,
			department.name as department
		FROM
			part
			INNER JOIN ingredient on ingredient_id = ingredient.id
			INNER JOIN unit on unit_id = unit.id
			LEFT JOIN ingredient_department on ingredient_department.ingredient_id = ingredient.id
			LEFT JOIN department on department.id = ingredient_department.department_id
		WHERE
		recipe_id = ?;
	`
	results, err := db.Query(query, id)
	ingredients := make([]common.Ingredient, 0)

	if err != nil {
		log.Println(err)
		return nil, err
	}

	for results.Next() {
		var department sql.NullString
		ingredient := common.Ingredient{}
		err = results.Scan(&ingredient.Name, &ingredient.Unit, &ingredient.Quantity, &department)

		if err != nil {
			log.Println(err)
			return nil, err
		}

		if department.Valid {
			ingredient.Department = department.String
		} else {
			ingredient.Department = ""
		}

		ingredients = append(ingredients, ingredient)
	}
	return ingredients, nil
}

// GetRecipeBySlug fetches a recipe from the database by Slug
func GetRecipeBySlug(slug string, userID string, db *sql.DB) (*common.Recipe, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}, Tags: []string{}}
	query := `
		SELECT id, name, remote_url, notes, tag_name
			FROM recipe
			LEFT JOIN recipe_tag on recipe.id = recipe_tag.recipe_id
			WHERE slug = ? AND account_id = ?;`

	results, err := db.Query(query, slug, accountID)

	if err != nil {
		log.Println("Error querying recipe")
		return nil, err
	}
	for results.Next() {
		var remoteURL sql.NullString
		var notes sql.NullString
		var tag sql.NullString

		err = results.Scan(&recipe.ID, &recipe.Name, &remoteURL, &notes, &tag)
		if err != nil {
			return nil, err
		}

		// Add tags from multiple rows and continue
		if recipe.ID > 0 && tag.Valid {
			recipe.Tags = append(recipe.Tags, tag.String)
			continue
		}

		if remoteURL.Valid {
			recipe.RemoteURL = remoteURL.String
		}

		if notes.Valid {
			recipe.Notes = notes.String
		}

		if tag.Valid {
			recipe.Tags = []string{tag.String}
		}

		ingredients, err := getIngredientsByRecipeID(recipe.ID, db)

		if err != nil {
			log.Println(err)
			return nil, err
		}

		recipe.Ingredients = ingredients
	}
	return recipe, nil
}

// GetRecipeByID fetches a recipe from the database by ID
func GetRecipeByID(id int, userID string, db *sql.DB) (*common.Recipe, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		log.Println(err)
		return nil, err
	}
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}, Tags: []string{}}
	query := `
		SELECT recipe.id, name, remote_url, notes, tag_name
			FROM recipe
			LEFT JOIN recipe_tag on recipe.id = recipe_tag.recipe_id
			WHERE recipe.id = ? AND account_id = ?;`

	results, err := db.Query(query, id, accountID)

	if err != nil {
		log.Println("Error querying recipe")
		return nil, err
	}

	for results.Next() {
		var remoteURL sql.NullString
		var notes sql.NullString
		var tag sql.NullString

		err = results.Scan(&recipe.ID, &recipe.Name, &remoteURL, &notes, &tag)
		if err != nil {
			return nil, err
		}

		// Add tags from multiple rows and continue
		if recipe.ID > 0 && tag.Valid {
			recipe.Tags = append(recipe.Tags, tag.String)
			continue
		}

		if remoteURL.Valid {
			recipe.RemoteURL = remoteURL.String
		}

		if notes.Valid {
			recipe.Notes = notes.String
		}

		if tag.Valid {
			recipe.Tags = []string{tag.String}
		}

		ingredients, err := getIngredientsByRecipeID(id, db)

		if err != nil {
			log.Println(err)
			return nil, err
		}

		log.Println("ingredients")
		log.Println(ingredients)

		recipe.Ingredients = ingredients
	}
	log.Println("recipe")
	log.Println(recipe)
	return recipe, nil
}

// AddRecipe inserts recipe, ingredients into the DB
func AddRecipe(recipe common.Recipe, userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	query := "INSERT INTO recipe (name, slug, remote_url, notes, account_id) VALUES (?, ?, ?, ?, ?);"
	res, err := db.Exec(query, recipe.Name, common.Slugify(recipe.Name), recipe.RemoteURL, recipe.Notes, accountID)

	if err != nil {
		fmt.Println("could not insert recipe")
		return err
	}

	id, err := res.LastInsertId()
	recipe.ID = int(id)

	if err = insertIngredients(recipe, db); err != nil {
		return err
	}
	if err = insertParts(recipe, db); err != nil {
		return err
	}
	if err = insertTags(recipe, db); err != nil {
		return err
	}
	return nil
}

// EditRecipe updates recipe information
func EditRecipe(recipe common.Recipe, userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	var id string
	// Checking to see if this recipe exists for this user
	if err := db.QueryRow("SELECT id FROM recipe WHERE id=? AND account_id = ?;", recipe.ID, accountID).Scan(&id); err == sql.ErrNoRows {
		fmt.Println("no results")
		return err
	} else if err != nil {
		return err
	}

	updateQuery := "UPDATE recipe SET name=?, remote_url=?, notes=? WHERE id=? AND account_id=?"
	if _, err := db.Exec(updateQuery, recipe.Name, recipe.RemoteURL, recipe.Notes, recipe.ID, accountID); err != nil {
		log.Println(err)
		return err
	}

	if err := insertIngredients(recipe, db); err != nil {
		log.Println(err)
		return err
	}

	// Delete the existing relationships between recipe & ingredients
	if _, err := db.Exec("DELETE FROM part WHERE recipe_id=?", recipe.ID); err != nil {
		log.Println(err)
		return err
	}

	if err := insertParts(recipe, db); err != nil {
		log.Println(err)
		return err
	}

	if err = insertTags(recipe, db); err != nil {
		return err
	}
	return nil
}

// DeleteRecipe removes a recipe from the db
func DeleteRecipe(recipe common.Recipe, userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	var id string
	// Checking to see if this recipe exists for this user
	if err := db.QueryRow("SELECT id FROM recipe WHERE id=? AND account_id = ?;", recipe.ID, accountID).Scan(&id); err == sql.ErrNoRows {
		fmt.Println("no results")
		return err
	} else if err != nil {
		return err
	}

	// Delete the existing relationships between recipe & ingredients
	if _, err := db.Exec("DELETE FROM part WHERE recipe_id=?;", recipe.ID); err != nil {
		return err
	}

	// Delete the existing relationships between recipe & tags
	if _, err := db.Exec("DELETE FROM tag WHERE recipe_id=?;", recipe.ID); err != nil {
		return err
	}

	// Delete the recipe items from the shopping list
	if _, err := db.Exec("DELETE FROM list WHERE recipe_id=? and account_id=?;", recipe.ID, accountID); err != nil {
		return err
	}

	if _, err := db.Exec("DELETE FROM recipe WHERE id=? and account_id = ?;", recipe.ID, accountID); err != nil {
		return err
	}

	return nil
}

func insertIngredients(recipe common.Recipe, db *sql.DB) error {
	ingredientQuery := "INSERT INTO ingredient (name) values "
	for idx, ingredient := range recipe.Ingredients {
		ingredientQuery += fmt.Sprintf("('%s')", ingredient.Name)
		if idx != len(recipe.Ingredients)-1 {
			ingredientQuery += ","
		}
	}
	ingredientQuery += " ON DUPLICATE KEY UPDATE id=id;"

	if _, err := db.Exec(ingredientQuery); err != nil {
		fmt.Println("could not insert ingredients")
		return err
	}
	return nil
}

func insertParts(recipe common.Recipe, db *sql.DB) error {
	partsQuery := "INSERT INTO part (recipe_id, ingredient_id, unit_id, quantity) VALUES "
	for idx, ingredient := range recipe.Ingredients {
		partsQuery += fmt.Sprintf("(%d, ", recipe.ID)
		partsQuery += fmt.Sprintf("(SELECT id FROM ingredient WHERE name = '%s'),", ingredient.Name)
		partsQuery += fmt.Sprintf("(SELECT id FROM unit WHERE name = '%s'),", ingredient.Unit)
		partsQuery += fmt.Sprintf("%s) ", ingredient.Quantity)
		if idx != len(recipe.Ingredients)-1 {
			partsQuery += ","
		} else {
			partsQuery += ";"
		}
	}

	log.Println("partsQuery")
	log.Println(partsQuery)

	_, err := db.Exec(partsQuery)
	if err != nil {
		fmt.Println("could not insert part")
		return err
	}

	return nil
}

func insertTags(recipe common.Recipe, db *sql.DB) error {
	removeQuery := "DELETE FROM recipe_tag WHERE recipe_id = ?;"
	_, err := db.Exec(removeQuery, recipe.ID)
	if err != nil {
		fmt.Println("could not remove tags")
		return err
	}

	placeholders := []string{}
	placeholderValues := []interface{}{}

	addQuery := "INSERT INTO recipe_tag (recipe_id, tag_name) VALUES %s;"
	for _, tag := range recipe.Tags {
		placeholders = append(placeholders, "(?,?)")
		placeholderValues = append(placeholderValues, recipe.ID, tag)
	}
	_, err = db.Exec(fmt.Sprintf(addQuery, strings.Join(placeholders, ",")), placeholderValues...)
	if err != nil {
		fmt.Println("could not add tags")
		fmt.Println(err)
		return err
	}

	return nil
}
