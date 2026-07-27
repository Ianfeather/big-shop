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

// dbConn is the minimal interface GetAccountID needs, and so - transitively - anything
// that calls it while also needing to write (RemoveIngredientListItems,
// AddIngredientListItems) needs when run inside a transaction. Satisfied by both *sql.DB
// and *sql.Tx.
type dbConn interface {
	execer
	QueryRow(query string, args ...interface{}) *sql.Row
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
	if recipe.ID == 0 {
		return nil, sql.ErrNoRows
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

		recipe.Ingredients = ingredients
	}
	if recipe.ID == 0 {
		return nil, sql.ErrNoRows
	}
	return recipe, nil
}

// AddRecipe inserts recipe, ingredients into the DB. The recipe row and all of its
// ingredient/unit/part/tag rows are written in one transaction, so a failure partway
// through (e.g. a bad unit) doesn't leave an orphaned recipe with no Ingredient Lines.
// Returns the new recipe's ID so the caller can hand it back to the client
// (e.g. for a post-create redirect) without a follow-up lookup.
func AddRecipe(recipe common.Recipe, userID string, db *sql.DB) (int, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return 0, err
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	query := "INSERT INTO recipe (name, slug, remote_url, notes, method, account_id) VALUES (?, ?, ?, ?, ?, ?);"
	res, err := tx.Exec(query, recipe.Name, common.Slugify(recipe.Name), recipe.RemoteURL, recipe.Notes, recipe.Method, accountID)
	if err != nil {
		fmt.Println("could not insert recipe")
		return 0, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	recipe.ID = int(id)

	if err = insertIngredients(recipe, tx); err != nil {
		return 0, err
	}
	if err = insertUnits(recipe, tx); err != nil {
		return 0, err
	}
	if err = insertIngredientCatalog(recipe, tx); err != nil {
		return 0, err
	}
	if err = insertParts(recipe, tx); err != nil {
		return 0, err
	}
	if err = insertTags(recipe, tx); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return recipe.ID, nil
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
	if err := insertIngredientCatalog(recipe, tx); err != nil {
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

// insertIngredientCatalog records the Base Unit, Display Unit and Unit Sizes
// that Recipe Import proposed for Ingredients the Global Catalog hasn't seen
// before. Nothing to do for Manual Entry or for editing an existing Recipe,
// where the payload carries none.
//
// Applies only to Ingredients that did not exist before this save, detected by
// their having no Ingredient Lines yet. insertParts runs after this, and
// EditRecipe deletes its old parts after it too, so at this point a genuinely
// new Ingredient has zero rows in `part` and an established one has at least
// one.
//
// That check, rather than "is the column still unset", is load-bearing. NULL in
// base_unit_id means two different things: never curated, and curated as the
// default of gram. Onion is deliberately gram, so it is NULL, so an
// unset-column guard would happily let an import flip it to millilitre - which
// is exactly what happened when this was first written and tested against a
// live database. Restricting to new Ingredients also matches what the feature
// is for: the curated set covers what exists, this covers what arrives.
//
// The ON DUPLICATE KEY no-op on Unit Sizes is kept as a second line of defence.
//
// Must run after insertUnits: a proposed Unit Size can reference a Unit this
// same save is introducing, and the INSERT ... SELECT below matches nothing if
// the Unit row doesn't exist yet.
func insertIngredientCatalog(recipe common.Recipe, db execer) error {
	for _, ingredient := range recipe.Ingredients {
		if ingredient.BaseUnit != "" {
			// The subquery yields NULL for a Unit that doesn't exist, which
			// leaves the column NULL rather than writing nonsense - so an
			// invented Base Unit is inert instead of corrupting the catalog.
			query := `
				UPDATE ingredient SET base_unit_id = (SELECT id FROM unit WHERE name = ?)
				WHERE name = ? AND base_unit_id IS NULL
				  AND NOT EXISTS (SELECT 1 FROM part WHERE part.ingredient_id = ingredient.id);`
			if _, err := db.Exec(query, ingredient.BaseUnit, ingredient.Name); err != nil {
				fmt.Println("could not set ingredient base unit")
				return err
			}
		}

		if ingredient.DisplayUnit != nil {
			query := `
				UPDATE ingredient SET display_unit_id = (SELECT id FROM unit WHERE name = ?)
				WHERE name = ? AND display_unit_id IS NULL
				  AND NOT EXISTS (SELECT 1 FROM part WHERE part.ingredient_id = ingredient.id);`
			if _, err := db.Exec(query, *ingredient.DisplayUnit, ingredient.Name); err != nil {
				fmt.Println("could not set ingredient display unit")
				return err
			}
		}

		for unit, size := range ingredient.UnitSizes {
			if size <= 0 {
				continue
			}
			// INSERT ... SELECT so a missing Ingredient or Unit simply matches
			// no rows, and ON DUPLICATE KEY as a deliberate no-op so an existing
			// Unit Size wins over the proposal.
			query := `
				INSERT INTO ingredient_unit_size (ingredient_id, unit_id, size)
				SELECT i.id, u.id, ? FROM ingredient i, unit u
				WHERE i.name = ? AND u.name = ?
				  AND NOT EXISTS (SELECT 1 FROM part WHERE part.ingredient_id = i.id)
				ON DUPLICATE KEY UPDATE ingredient_unit_size.ingredient_id = ingredient_unit_size.ingredient_id;`
			if _, err := db.Exec(query, size, ingredient.Name, unit); err != nil {
				fmt.Println("could not set ingredient unit size")
				return err
			}
		}
	}
	return nil
}
