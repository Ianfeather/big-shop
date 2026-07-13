package service

import (
	"recipes/internal/pkg/common"
	"strings"

	"database/sql"
	"fmt"
	"log"
)

// execer is the minimal interface insertIngredients, insertUnits, insertParts, and
// insertTags need - satisfied by both *sql.DB and *sql.Tx, so AddRecipe/EditRecipe can pass
// either a bare connection or an in-flight transaction through the same call sites.
type execer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

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
		SELECT recipe.id, name, remote_url, notes, method, tag_name
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
		var method sql.NullString
		var tag sql.NullString
		var id int

		err = results.Scan(&id, &recipe.Name, &remoteURL, &notes, &method, &tag)
		if err != nil {
			return nil, err
		}

		// Add tags from multiple rows and continue
		if recipe.ID > 0 && tag.Valid {
			recipe.Tags = append(recipe.Tags, tag.String)
			continue
		}

		recipe.ID = id

		if remoteURL.Valid {
			recipe.RemoteURL = remoteURL.String
		}

		if notes.Valid {
			recipe.Notes = notes.String
		}

		if method.Valid {
			recipe.Method = method.String
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
		SELECT recipe.id, name, remote_url, notes, method, tag_name
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
		var method sql.NullString
		var tag sql.NullString
		var id int

		err = results.Scan(&id, &recipe.Name, &remoteURL, &notes, &method, &tag)
		if err != nil {
			return nil, err
		}

		// Add tags from multiple rows and continue
		if recipe.ID > 0 && tag.Valid {
			recipe.Tags = append(recipe.Tags, tag.String)
			continue
		}

		recipe.ID = id

		if remoteURL.Valid {
			recipe.RemoteURL = remoteURL.String
		}

		if notes.Valid {
			recipe.Notes = notes.String
		}

		if method.Valid {
			recipe.Method = method.String
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

// AddRecipe inserts recipe, ingredients into the DB. The recipe row and all of its
// ingredient/unit/part/tag rows are written in one transaction, so a failure partway
// through (e.g. a bad unit) doesn't leave an orphaned recipe with no Ingredient Lines.
func AddRecipe(recipe common.Recipe, userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	query := "INSERT INTO recipe (name, slug, remote_url, notes, method, account_id) VALUES (?, ?, ?, ?, ?, ?);"
	res, err := tx.Exec(query, recipe.Name, common.Slugify(recipe.Name), recipe.RemoteURL, recipe.Notes, recipe.Method, accountID)
	if err != nil {
		fmt.Println("could not insert recipe")
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	recipe.ID = int(id)

	if err = insertIngredients(recipe, tx); err != nil {
		return err
	}
	if err = insertUnits(recipe, tx); err != nil {
		return err
	}
	if err = insertParts(recipe, tx); err != nil {
		return err
	}
	if err = insertTags(recipe, tx); err != nil {
		return err
	}
	return tx.Commit()
}

// EditRecipe updates recipe information. The ownership check is a precondition, run
// before opening a transaction; the update and all of its ingredient/unit/part/tag
// writes then happen in one transaction, so a failure partway through (e.g. between
// deleting and reinserting the recipe's Ingredient Lines) doesn't leave the recipe with
// no Ingredient Lines.
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

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	updateQuery := "UPDATE recipe SET name=?, remote_url=?, notes=?, method=? WHERE id=? AND account_id=?"
	if _, err := tx.Exec(updateQuery, recipe.Name, recipe.RemoteURL, recipe.Notes, recipe.Method, recipe.ID, accountID); err != nil {
		log.Println(err)
		return err
	}

	if err := insertIngredients(recipe, tx); err != nil {
		log.Println(err)
		return err
	}

	if err := insertUnits(recipe, tx); err != nil {
		log.Println(err)
		return err
	}

	// Delete the existing relationships between recipe & ingredients
	if _, err := tx.Exec("DELETE FROM part WHERE recipe_id=?", recipe.ID); err != nil {
		log.Println(err)
		return err
	}

	if err := insertParts(recipe, tx); err != nil {
		log.Println(err)
		return err
	}

	if err = insertTags(recipe, tx); err != nil {
		return err
	}
	return tx.Commit()
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
	if _, err := db.Exec("DELETE FROM recipe_tag WHERE recipe_id=?;", recipe.ID); err != nil {
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

func insertIngredients(recipe common.Recipe, db execer) error {
	if len(recipe.Ingredients) == 0 {
		return nil
	}
	placeholders := []string{}
	placeholderValues := []interface{}{}
	for _, ingredient := range recipe.Ingredients {
		placeholders = append(placeholders, "(?)")
		placeholderValues = append(placeholderValues, ingredient.Name)
	}
	query := fmt.Sprintf("INSERT INTO ingredient (name) VALUES %s ON DUPLICATE KEY UPDATE id=id;", strings.Join(placeholders, ","))

	if _, err := db.Exec(query, placeholderValues...); err != nil {
		fmt.Println("could not insert ingredients")
		return err
	}
	return nil
}

// insertUnits upserts every unit referenced by the recipe's ingredients, including a blank
// ("no unit, just a count") entry where needed, mirroring insertIngredients. Without this, a
// unit that doesn't already exist (e.g. "bunch") leaves part.unit_id with nothing to reference,
// which fails the recipe save outright since that column is NOT NULL.
func insertUnits(recipe common.Recipe, db execer) error {
	if len(recipe.Ingredients) == 0 {
		return nil
	}
	placeholders := []string{}
	placeholderValues := []interface{}{}
	for _, ingredient := range recipe.Ingredients {
		placeholders = append(placeholders, "(?)")
		placeholderValues = append(placeholderValues, ingredient.Unit)
	}
	query := fmt.Sprintf("INSERT INTO unit (name) VALUES %s ON DUPLICATE KEY UPDATE id=id;", strings.Join(placeholders, ","))

	if _, err := db.Exec(query, placeholderValues...); err != nil {
		fmt.Println("could not insert units")
		return err
	}
	return nil
}

func insertParts(recipe common.Recipe, db execer) error {
	if len(recipe.Ingredients) == 0 {
		return nil
	}
	placeholders := []string{}
	placeholderValues := []interface{}{}
	for _, ingredient := range recipe.Ingredients {
		placeholders = append(placeholders, "(?, (SELECT id FROM ingredient WHERE name = ?), (SELECT id FROM unit WHERE name = ?), ?)")
		placeholderValues = append(placeholderValues, recipe.ID, ingredient.Name, ingredient.Unit, ingredient.Quantity)
	}
	query := fmt.Sprintf("INSERT INTO part (recipe_id, ingredient_id, unit_id, quantity) VALUES %s;", strings.Join(placeholders, ","))

	if _, err := db.Exec(query, placeholderValues...); err != nil {
		fmt.Println("could not insert part")
		return err
	}

	return nil
}

func insertTags(recipe common.Recipe, db execer) error {
	removeQuery := "DELETE FROM recipe_tag WHERE recipe_id = ?;"
	_, err := db.Exec(removeQuery, recipe.ID)
	if err != nil {
		fmt.Println("could not remove tags")
		return err
	}

	placeholders := []string{}
	placeholderValues := []interface{}{}

	if len(recipe.Tags) == 0 {
		return nil
	}

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
