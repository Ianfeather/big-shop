package service

import (
	"context"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/telemetry"
	"strings"

	"database/sql"
	"fmt"
)

// execer is the minimal interface insertIngredients, insertUnits, insertParts, and
// insertTags need - satisfied by both *sql.DB and *sql.Tx, so AddRecipe/EditRecipe can pass
// either a bare connection or an in-flight transaction through the same call sites.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
}

// dbConn is the minimal interface GetAccountID needs, and so - transitively - anything
// that calls it while also needing to write (RemoveIngredientListItems,
// AddIngredientListItems) needs when run inside a transaction. Satisfied by both *sql.DB
// and *sql.Tx.
type dbConn interface {
	execer
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

func getIngredientsByRecipeID(ctx context.Context, id int, db *sql.DB) ([]common.Ingredient, error) {
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
	results, err := db.QueryContext(ctx, query, id)
	ingredients := make([]common.Ingredient, 0)

	if err != nil {
		return nil, fmt.Errorf("querying ingredients for recipe %d: %w", id, err)
	}
	defer results.Close()

	for results.Next() {
		var department sql.NullString
		ingredient := common.Ingredient{}
		err = results.Scan(&ingredient.Name, &ingredient.Unit, &ingredient.Quantity, &department)

		if err != nil {
			return nil, fmt.Errorf("scanning ingredient row for recipe %d: %w", id, err)
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
func GetRecipeBySlug(ctx context.Context, slug string, caller *common.Caller, db *sql.DB) (*common.Recipe, error) {
	accountID, err := caller.AccountID()
	if err != nil {
		return nil, err
	}
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}, Tags: []string{}}
	query := `
		SELECT recipe.id, name, remote_url, notes, method, tag_name
			FROM recipe
			LEFT JOIN recipe_tag on recipe.id = recipe_tag.recipe_id
			WHERE slug = ? AND account_id = ?;`

	results, err := db.QueryContext(ctx, query, slug, accountID)

	if err != nil {
		return nil, fmt.Errorf("querying recipe: %w", err)
	}
	defer results.Close()
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

		ingredients, err := getIngredientsByRecipeID(ctx, recipe.ID, db)

		if err != nil {
			return nil, fmt.Errorf("loading ingredients: %w", err)
		}

		recipe.Ingredients = ingredients
	}
	if recipe.ID == 0 {
		return nil, sql.ErrNoRows
	}
	return recipe, nil
}

// GetRecipeByID fetches a recipe from the database by ID
func GetRecipeByID(ctx context.Context, id int, caller *common.Caller, db *sql.DB) (*common.Recipe, error) {
	accountID, err := caller.AccountID()
	if err != nil {
		return nil, fmt.Errorf("resolving account: %w", err)
	}
	recipe := &common.Recipe{Ingredients: []common.Ingredient{}, Tags: []string{}}
	query := `
		SELECT recipe.id, name, remote_url, notes, method, tag_name
			FROM recipe
			LEFT JOIN recipe_tag on recipe.id = recipe_tag.recipe_id
			WHERE recipe.id = ? AND account_id = ?;`

	results, err := db.QueryContext(ctx, query, id, accountID)

	if err != nil {
		return nil, fmt.Errorf("querying recipe: %w", err)
	}
	defer results.Close()

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

		ingredients, err := getIngredientsByRecipeID(ctx, id, db)

		if err != nil {
			return nil, fmt.Errorf("loading ingredients: %w", err)
		}

		recipe.Ingredients = ingredients
	}
	if recipe.ID == 0 {
		return nil, sql.ErrNoRows
	}
	return recipe, nil
}

// GetRecipeIngredientsByIDs loads just the Ingredient Lines of a whole set of
// Recipes, in one query, and returns one Recipe per requested id carrying
// nothing but its ID and its Ingredients.
//
// It exists because generating a Shopping List called GetRecipeByID in a loop,
// six round trips per Recipe - which is why POST /shopping-list cost 42 round
// trips for one Recipe and 50 for two. The +8 slope was the thing worth
// killing: a ten-Recipe list was ~114. CombineIngredients reads only ID and
// Ingredients, so the per-Recipe loop was also fetching name, notes, method and
// tags and throwing them away.
//
// **Not a general-purpose Recipe loader**, and deliberately not named like one:
// every other field is zero. Use GetRecipeByID when you want a Recipe.
//
// Three details are load-bearing:
//
//   - The join hangs off `recipe` with a LEFT JOIN to `part`, not off `part`.
//     That is what lets a Recipe with no Ingredient Lines come back at all, and
//     so what preserves GetRecipeByID's distinction between "no such Recipe"
//     (sql.ErrNoRows) and "a Recipe that happens to have no lines" (an empty
//     slice). Joining from `part` would collapse the two silently.
//   - One entry per *requested* id, in the requested order, so a duplicate id
//     still contributes twice exactly as the old loop did. Nothing sends
//     duplicates today - pages/list.tsx keys its selection by id - but that is
//     the caller's property, not this function's, and de-duplicating here would
//     quietly halve a total if it ever changed.
//   - ORDER BY part.id keeps an Ingredient Line's position stable, which the
//     old query left to the storage engine.
func GetRecipeIngredientsByIDs(ctx context.Context, ids []int, caller *common.Caller, db *sql.DB) ([]common.Recipe, error) {
	if len(ids) == 0 {
		return []common.Recipe{}, nil
	}

	accountID, err := caller.AccountID()
	if err != nil {
		return nil, fmt.Errorf("resolving account: %w", err)
	}

	placeholders := make([]string, 0, len(ids))
	args := make([]interface{}, 0, len(ids)+1)
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	args = append(args, accountID)

	// ingredient_department is UNIQUE (ingredient_id) (migration 013), so the
	// department joins cannot multiply a Line into several rows.
	query := fmt.Sprintf(`
		SELECT
			recipe.id,
			ingredient.name,
			unit.name,
			part.quantity,
			department.name
		FROM
			recipe
			LEFT JOIN part on part.recipe_id = recipe.id
			LEFT JOIN ingredient on part.ingredient_id = ingredient.id
			LEFT JOIN unit on part.unit_id = unit.id
			LEFT JOIN ingredient_department on ingredient_department.ingredient_id = ingredient.id
			LEFT JOIN department on department.id = ingredient_department.department_id
		WHERE recipe.id IN (%s) AND recipe.account_id = ?
		ORDER BY part.id;
	`, strings.Join(placeholders, ","))

	results, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying recipe ingredients: %w", err)
	}
	defer results.Close()

	byRecipe := make(map[int][]common.Ingredient, len(ids))
	for results.Next() {
		var recipeID int
		var name, unit, quantity, department sql.NullString
		if err := results.Scan(&recipeID, &name, &unit, &quantity, &department); err != nil {
			return nil, fmt.Errorf("scanning recipe ingredient row: %w", err)
		}
		// The Recipe exists even when the LEFT JOIN found it no Ingredient
		// Lines; recording the key with a nil slice is what says so.
		lines := byRecipe[recipeID]
		if !name.Valid {
			byRecipe[recipeID] = lines
			continue
		}
		byRecipe[recipeID] = append(lines, common.Ingredient{
			Name:       name.String,
			Unit:       unit.String,
			Quantity:   quantity.String,
			Department: department.String,
		})
	}
	if err := results.Err(); err != nil {
		return nil, err
	}

	recipes := make([]common.Recipe, 0, len(ids))
	for _, id := range ids {
		lines, ok := byRecipe[id]
		if !ok {
			// Same sentinel the per-Recipe loop raised, for the same two
			// reasons: the id is nobody's, or it belongs to another Account.
			return nil, sql.ErrNoRows
		}
		if lines == nil {
			lines = []common.Ingredient{}
		}
		recipes = append(recipes, common.Recipe{ID: id, Ingredients: lines})
	}
	return recipes, nil
}

// AddRecipe inserts recipe, ingredients into the DB. The recipe row and all of its
// ingredient/unit/part/tag rows are written in one transaction, so a failure partway
// through (e.g. a bad unit) doesn't leave an orphaned recipe with no Ingredient Lines.
// Returns the new recipe's ID so the caller can hand it back to the client
// (e.g. for a post-create redirect) without a follow-up lookup.
func AddRecipe(ctx context.Context, recipe common.Recipe, caller *common.Caller, db *sql.DB) (int, error) {
	recipe = withCanonicalUnits(recipe)

	accountID, err := caller.AccountID()
	if err != nil {
		return 0, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	query := "INSERT INTO recipe (name, slug, remote_url, notes, method, account_id) VALUES (?, ?, ?, ?, ?, ?);"
	res, err := tx.ExecContext(ctx, query, recipe.Name, common.Slugify(recipe.Name), recipe.RemoteURL, recipe.Notes, recipe.Method, accountID)
	if err != nil {
		return 0, fmt.Errorf("insert recipe: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	recipe.ID = int(id)

	if err = insertIngredients(ctx, recipe, tx); err != nil {
		return 0, err
	}
	if err = insertUnits(ctx, recipe, tx); err != nil {
		return 0, err
	}
	classifyNewIngredients(ctx, recipe, tx)
	if err = insertParts(ctx, recipe, tx); err != nil {
		return 0, err
	}
	if err = insertTags(ctx, recipe, tx); err != nil {
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
func EditRecipe(ctx context.Context, recipe common.Recipe, caller *common.Caller, db *sql.DB) error {
	recipe = withCanonicalUnits(recipe)

	accountID, err := caller.AccountID()
	if err != nil {
		return fmt.Errorf("resolving account: %w", err)
	}
	var id string
	// Checking to see if this recipe exists for this user
	if err := db.QueryRowContext(ctx, "SELECT id FROM recipe WHERE id=? AND account_id = ?;", recipe.ID, accountID).Scan(&id); err == sql.ErrNoRows {
		// Returned unwrapped: it is a sentinel, and its identity is the whole
		// message. Wrapping it would add "no results:" to an error that already
		// says exactly that, and break any caller comparing against it.
		return err
	} else if err != nil {
		return fmt.Errorf("checking the recipe exists: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	updateQuery := "UPDATE recipe SET name=?, remote_url=?, notes=?, method=? WHERE id=? AND account_id=?"
	if _, err := tx.ExecContext(ctx, updateQuery, recipe.Name, recipe.RemoteURL, recipe.Notes, recipe.Method, recipe.ID, accountID); err != nil {
		return fmt.Errorf("updating recipe %d: %w", recipe.ID, err)
	}

	if err := insertIngredients(ctx, recipe, tx); err != nil {
		return fmt.Errorf("inserting ingredients: %w", err)
	}

	if err := insertUnits(ctx, recipe, tx); err != nil {
		return fmt.Errorf("inserting units: %w", err)
	}
	classifyNewIngredients(ctx, recipe, tx)

	// Delete the existing relationships between recipe & ingredients
	if _, err := tx.ExecContext(ctx, "DELETE FROM part WHERE recipe_id=?", recipe.ID); err != nil {
		return fmt.Errorf("clearing recipe %d's ingredient links: %w", recipe.ID, err)
	}

	if err := insertParts(ctx, recipe, tx); err != nil {
		return fmt.Errorf("inserting ingredient links: %w", err)
	}

	if err = insertTags(ctx, recipe, tx); err != nil {
		return fmt.Errorf("inserting tags: %w", err)
	}
	return tx.Commit()
}

// scope is a WHERE fragment and the arguments that fill it, carried together
// because they are only correct together. deleteRecipeData below builds three
// of them and reuses one across two statements; as loose (string, []interface{})
// pairs, an edit to the fragment that forgot its arguments - or an argument
// list rebuilt between the two statements that share it - would produce a
// silently mis-scoped DELETE rather than a compile error.
type scope struct {
	where string
	args  []interface{}
}

// withAccountID prefixes a direct account_id predicate, for the two tables that
// carry their own copy of it. Redundant against the subquery, but it keeps them
// on an indexed column and preserves exactly what the previous per-recipe
// statements asserted.
func (s scope) withAccountID(accountID int) scope {
	// A fresh slice, not an append onto s.args: the literal has len == cap == 1,
	// so this cannot write through into the scope it was derived from.
	return scope{
		where: "account_id = ? AND " + s.where,
		args:  append([]interface{}{accountID}, s.args...),
	}
}

// deleteRecipeData removes everything hanging off a set of Recipes, in the one
// order that satisfies the foreign keys. **It is the only place that order
// lives**, and that is the whole point of it existing.
//
// **The caller must pass a transaction.** The parameter is `execer` rather than
// `*sql.Tx` so that the tests can drive it without a database, matching what
// insertIngredients/insertParts/insertTags in this file already do - but that
// widening means *sql.DB satisfies it too, and a caller passing one gets five
// unatomic statements and the half-deleted Recipe this function exists to
// prevent. The type cannot enforce it; this comment is the enforcement.
//
// Nothing here touches `ingredient`, `unit`, `tag`, `department`,
// `ingredient_department` or `ingredient_unit_size`, and that is deliberate
// rather than an omission: per ADR-0001 the Global Ingredient Catalog is shared
// by every Account, its names are not personal data, and erasing "their"
// ingredients would damage everyone else's. Only the join tables that link a
// Recipe to the catalog (`part`, `recipe_tag`) are removed. This matters most
// to DeleteAccount, the caller this function was extracted to serve, where the
// temptation to go looking for a departing user's ingredients is strongest.
//
// The alternative shapes are both wrong. Looping DeleteRecipe over every Recipe
// in an Account is N times the queries and still leaves the `list` and
// `shopping_list_event` rows that aren't tied to a Recipe at all. Hand-writing a
// second, account-scoped cascade means two orderings that have to be kept in
// sync forever, and the second one drifts the first time a table is added. So:
// one set-based primitive, two entry points - DeleteRecipe below, and
// DeleteAccount, which needs the same order over a whole Account.
//
// recipeIDs == nil means "every Recipe in the account", which is what account
// deletion wants and what keeps this from being run in a loop. A non-nil but
// empty slice means "no Recipes", and does nothing - the distinction matters,
// because collapsing the two would turn an empty selection into a full wipe.
//
// Every statement is account-scoped even when explicit ids are given: the ids
// are filtered through `recipe.account_id` rather than trusted, so a caller
// cannot reach another Account's rows by passing its ids.
func deleteRecipeData(ctx context.Context, tx execer, accountID int, recipeIDs []int) error {
	if recipeIDs != nil && len(recipeIDs) == 0 {
		return nil
	}

	// The child tables (part, recipe_tag) carry no account_id of their own, so
	// their scope has to come from `recipe` via a subquery.
	//
	// `recipe_id IN (subquery)` also excludes NULLs, which is correct: a `list`
	// row with no recipe_id is an Extra Item and a `shopping_list_event` with
	// none is not about a Recipe. Neither belongs to any Recipe, so neither is
	// this function's to delete - DeleteAccount removes them separately.
	children := scope{
		where: "recipe_id IN (SELECT id FROM recipe WHERE account_id = ?)",
		args:  []interface{}{accountID},
	}
	// The final DELETE cannot use that subquery: MySQL refuses to delete from a
	// table while selecting from it in the same statement (error 1093), so the
	// Recipe delete states its scope directly.
	recipes := scope{
		where: "account_id = ?",
		args:  []interface{}{accountID},
	}

	if recipeIDs != nil {
		// Given ids are filtered *through* recipe.account_id rather than
		// trusted, so a caller passing another Account's ids reaches nothing.
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(recipeIDs)), ",")
		ids := make([]interface{}, 0, len(recipeIDs)+1)
		ids = append(ids, accountID)
		for _, id := range recipeIDs {
			ids = append(ids, id)
		}
		children = scope{
			where: fmt.Sprintf("recipe_id IN (SELECT id FROM recipe WHERE account_id = ? AND id IN (%s))", placeholders),
			args:  ids,
		}
		recipes = scope{
			where: fmt.Sprintf("account_id = ? AND id IN (%s)", placeholders),
			args:  append([]interface{}{}, ids...),
		}
	}

	// list and shopping_list_event carry their own account_id, so they take the
	// subquery *and* a direct predicate. Derived once and shared by both, which
	// is safe because a scope is immutable once built.
	ownedChildren := children.withAccountID(accountID)

	// The relationships between recipe & ingredients.
	if _, err := tx.ExecContext(ctx, "DELETE FROM part WHERE "+children.where+";", children.args...); err != nil {
		return fmt.Errorf("deleting recipe ingredient links: %w", err)
	}

	// The relationships between recipe & tags.
	if _, err := tx.ExecContext(ctx, "DELETE FROM recipe_tag WHERE "+children.where+";", children.args...); err != nil {
		return fmt.Errorf("deleting recipe tag links: %w", err)
	}

	// The recipe's items on the shopping list.
	if _, err := tx.ExecContext(ctx, "DELETE FROM list WHERE "+ownedChildren.where+";", ownedChildren.args...); err != nil {
		return fmt.Errorf("deleting recipe list items: %w", err)
	}

	// And its Shopping List Events. migrations/015 puts a foreign key on
	// shopping_list_event.recipe_id, so without this the DELETE below fails with
	// "Cannot delete or update a parent row" for any Recipe that has ever been
	// added to a list - which is every Recipe anyone has actually cooked from.
	//
	// Deleting rather than nulling the column: the rows only exist to let Dave
	// infer Recent and Favorite Recipes, `recipe_usage_summary` filters on
	// `recipe_id IS NOT NULL`, and a Recipe that no longer exists cannot be
	// suggested - so a nulled row would be dead weight. It also matches what
	// this function already does with the Recipe's parts, tags and list items.
	if _, err := tx.ExecContext(ctx, "DELETE FROM shopping_list_event WHERE "+ownedChildren.where+";", ownedChildren.args...); err != nil {
		return fmt.Errorf("deleting recipe shopping list events: %w", err)
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM recipe WHERE "+recipes.where+";", recipes.args...); err != nil {
		return fmt.Errorf("deleting recipes: %w", err)
	}

	return nil
}

// DeleteRecipe removes a recipe from the db.
//
// A thin caller of deleteRecipeData: the cascade order lives there, and this
// adds only the "does it exist, and is it theirs" check and the transaction.
func DeleteRecipe(ctx context.Context, recipe common.Recipe, caller *common.Caller, db *sql.DB) error {
	accountID, err := caller.AccountID()
	if err != nil {
		return fmt.Errorf("resolving account: %w", err)
	}

	var id string
	// Checking to see if this recipe exists for this user. A precondition, run
	// before opening a transaction - the same shape EditRecipe uses and states
	// in its own comment, so the two siblings agree: there is nothing to roll
	// back if the answer is "not yours", and it keeps the transaction's life as
	// short as the writes themselves.
	if err := db.QueryRowContext(ctx, "SELECT id FROM recipe WHERE id=? AND account_id = ?;", recipe.ID, accountID).Scan(&id); err == sql.ErrNoRows {
		// Returned unwrapped: it is a sentinel, and its identity is the whole
		// message. Wrapping it would add "no results:" to an error that already
		// says exactly that, and break any caller comparing against it.
		return err
	} else if err != nil {
		return err
	}

	// One transaction, which this has always needed and never had: the cascade
	// is five statements, and a failure part-way through used to leave a Recipe
	// stripped of its parts, tags and list items but still present - readable,
	// and empty.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// Unwrapped deliberately: deleteRecipeData names the failing table in its
	// own error, and wrapping again would only prefix a second "deleting…".
	if err := deleteRecipeData(ctx, tx, accountID, []int{recipe.ID}); err != nil {
		return err
	}

	return tx.Commit()
}

func insertIngredients(ctx context.Context, recipe common.Recipe, db execer) error {
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

	if _, err := db.ExecContext(ctx, query, placeholderValues...); err != nil {
		return fmt.Errorf("insert ingredients: %w", err)
	}
	return nil
}

// insertUnits upserts every unit referenced by the recipe's ingredients, including a blank
// ("no unit, just a count") entry where needed, mirroring insertIngredients. Without this, a
// unit that doesn't already exist (e.g. "bunch") leaves part.unit_id with nothing to reference,
// which fails the recipe save outright since that column is NOT NULL.
func insertUnits(ctx context.Context, recipe common.Recipe, db execer) error {
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

	if _, err := db.ExecContext(ctx, query, placeholderValues...); err != nil {
		return fmt.Errorf("insert units: %w", err)
	}
	return nil
}

func insertParts(ctx context.Context, recipe common.Recipe, db execer) error {
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

	if _, err := db.ExecContext(ctx, query, placeholderValues...); err != nil {
		return fmt.Errorf("insert part: %w", err)
	}

	return nil
}

func insertTags(ctx context.Context, recipe common.Recipe, db execer) error {
	removeQuery := "DELETE FROM recipe_tag WHERE recipe_id = ?;"
	_, err := db.ExecContext(ctx, removeQuery, recipe.ID)
	if err != nil {
		return fmt.Errorf("remove tags: %w", err)
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
	_, err = db.ExecContext(ctx, fmt.Sprintf(addQuery, strings.Join(placeholders, ",")), placeholderValues...)
	if err != nil {
		return fmt.Errorf("add tags: %w", err)
	}

	return nil
}

// classifyNewIngredients records the Base Unit, Display Unit and Unit Sizes
// that Recipe Import proposed for Ingredients the Global Catalog hasn't seen
// before. Nothing to do for Manual Entry or for editing an existing Recipe,
// where the payload carries none.
//
// Applies only to Ingredients not marked `curated` - i.e. ones no person has
// chosen values for.
//
// That marker replaced an earlier proxy, "the Ingredient has no Ingredient Lines
// yet", which leaked both ways: DeleteRecipe leaves an Ingredient line-less
// without deleting it, so a curated one could be reclassified, while an
// uncurated one that happened to be used by a Recipe could never be classified
// at all (follow-ups.md #27, migration 028).
//
// Note "is the column still unset" is *not* a sufficient guard on its own, which
// is what the spec originally recorded. NULL in base_unit_id means both "never
// curated" and "curated as the default, gram" - onion is deliberately gram, so
// it is NULL, and an unset-column guard let an import flip it to millilitre when
// this was first tested against a live database.
//
// The ON DUPLICATE KEY no-op on Unit Sizes is kept as a second line of defence.
//
// Must run after insertUnits: a proposed Unit Size can reference a Unit this
// same save is introducing, and the INSERT ... SELECT below matches nothing if
// the Unit row doesn't exist yet.
// Returns nothing, deliberately. The spec is explicit that "a classification
// failure must never fail a recipe save - the gap simply persists, and the list
// degrades to multiple Amounts, which is a supported state, not an error". An
// earlier version returned an error that both callers propagated, so a bad
// proposal rolled back the whole recipe. Making the signature errorless makes
// that structural rather than a rule each caller has to remember. A failed
// statement does not abort a MySQL transaction, so the surrounding save is
// unaffected.
func classifyNewIngredients(ctx context.Context, recipe common.Recipe, db execer) {
	for _, ingredient := range recipe.Ingredients {
		if ingredient.BaseUnit != "" {
			setIngredientUnitColumn(ctx, db, "base_unit_id", ingredient.BaseUnit, ingredient.Name)
		}
		if ingredient.DisplayUnit != nil {
			setIngredientUnitColumn(ctx, db, "display_unit_id", *ingredient.DisplayUnit, ingredient.Name)
		}
		if ingredient.PantryStaple {
			setPantryStaple(ctx, db, ingredient.Name)
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
				WHERE i.name = ? AND u.name = ? AND NOT i.curated
				ON DUPLICATE KEY UPDATE ingredient_unit_size.ingredient_id = ingredient_unit_size.ingredient_id;`
			if _, err := db.ExecContext(ctx, query, size, ingredient.Name, unit); err != nil {
				telemetry.RecordWarning(ctx, "set ingredient unit size", err)
			}
		}
	}
}

// setIngredientUnitColumn points one of ingredient's two unit columns at a Unit
// by name, for a new Ingredient that hasn't been curated.
//
// The column name is interpolated rather than parameterised because SQL does
// not allow a placeholder there; it is never caller-controlled, only ever one
// of the two literals above.
//
// Two guards, both load-bearing. The subquery yields NULL for a Unit that does
// not exist, so an invented Base Unit is inert rather than corrupting the
// catalog. And `NOT curated` keeps it away from values a person chose - see
// classifyNewIngredients for why "is the column still unset" is not sufficient.
func setIngredientUnitColumn(ctx context.Context, db execer, column, unitName, ingredientName string) {
	query := fmt.Sprintf(`
		UPDATE ingredient SET %s = (SELECT id FROM unit WHERE name = ?)
		WHERE name = ? AND %s IS NULL AND NOT curated;`, column, column)
	if _, err := db.ExecContext(ctx, query, unitName, ingredientName); err != nil {
		telemetry.RecordWarning(ctx, "set ingredient "+column, err)
	}
}

// setPantryStaple flags an Ingredient as a store-cupboard basic on Recipe
// Import's proposal, for the ones migration 032's list didn't cover.
//
// One-way, by construction: it is only ever reached for a true proposal, and it
// only ever writes true. That is what stands in for the `IS NULL` guard the two
// unit columns use - `pantry_staple` is NOT NULL with a default, so there is no
// "unset" state to test for, and re-proposing something already flagged has to
// be harmless rather than merely unlikely.
//
// `NOT curated` still applies, so anyone who deliberately un-flags an Ingredient
// by hand can mark it curated and have that stick.
func setPantryStaple(ctx context.Context, db execer, ingredientName string) {
	query := `UPDATE ingredient SET pantry_staple = TRUE WHERE name = ? AND NOT curated;`
	if _, err := db.ExecContext(ctx, query, ingredientName); err != nil {
		telemetry.RecordWarning(ctx, "set ingredient pantry_staple", err)
	}
}

// unitAliases maps spellings Recipe Import might produce onto the canonical Unit
// names the catalog uses. Resolves follow-ups.md #23.
//
// insertUnits upserts whatever string reaches it, and migration 019 classifies
// exactly six spellings - so an imported "ml" became a *Relative* Unit with no
// factor, which never combines with "millilitre" on a Shopping List. Silently:
// an unrecognised Unit is a legitimate state by design, so nothing looks wrong.
//
// The extraction prompt already asks for these to be expanded, and in 2.3 years
// it never got one wrong. This is defence in depth for the day it does, or for
// a path that doesn't go through the prompt at all.
var unitAliases = map[string]string{
	"g": "gram", "gr": "gram", "gm": "gram", "gms": "gram", "grams": "gram",
	"kg": "kilogram", "kgs": "kilogram", "kilograms": "kilogram", "kilo": "kilogram",
	"ml": "millilitre", "mls": "millilitre", "milliliter": "millilitre",
	"milliliters": "millilitre", "millilitres": "millilitre",
	"l": "litre", "ltr": "litre", "liter": "litre", "liters": "litre", "litres": "litre",
	"tsp": "teaspoon", "tsps": "teaspoon", "teaspoons": "teaspoon",
	"tbsp": "tablespoon", "tbsps": "tablespoon", "tbs": "tablespoon",
	"tablespoons": "tablespoon",
	"cloves":      "clove", "tins": "tin", "packets": "packet", "bottles": "bottle",
	"slices": "slice", "pinches": "pinch",
}

// canonicalUnit resolves one Unit name to the spelling the catalog uses.
//
// Trimming matters independently of the alias table: `unit`.`name` is UNIQUE
// under a case-insensitive collation, so "Gram" and "gram" cannot fragment - but
// " gram" and "gram" are different strings and can. Four ingredients in the live
// catalog have exactly that damage (follow-ups.md #25).
func canonicalUnit(name string) string {
	trimmed := strings.TrimSpace(name)
	if canonical, ok := unitAliases[strings.ToLower(trimmed)]; ok {
		return canonical
	}
	return trimmed
}

// withCanonicalUnits returns the Recipe with every Ingredient Line's Unit
// resolved to its canonical spelling.
//
// Applied once, before any of the insert steps, rather than inside insertUnits:
// insertParts resolves a Unit by name too, so normalising in one place and not
// the other would have them disagree and the part insert would find no Unit row.
func withCanonicalUnits(recipe common.Recipe) common.Recipe {
	ingredients := make([]common.Ingredient, len(recipe.Ingredients))
	copy(ingredients, recipe.Ingredients)
	for i := range ingredients {
		ingredients[i].Unit = canonicalUnit(ingredients[i].Unit)
	}
	recipe.Ingredients = ingredients
	return recipe
}
