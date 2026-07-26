package service

import (
	"errors"
	"fmt"
	"log"
	"recipes/internal/pkg/common"
	"sort"
	"strconv"

	"database/sql"
)

// ListItem is used to interface with the DB. One row of `list`, which is one
// Amount - an Ingredient Item with two Amounts is two rows sharing a name.
type ListItem struct {
	Name       string
	Unit       string
	Quantity   string
	Department string
	IsBought   bool
}

// ErrInvalidRecipeID is returned by GenerateShoppingList when a recipe id can't be
// parsed - a client error, distinct from the server errors everything else in this
// function can return.
var ErrInvalidRecipeID = errors.New("invalid recipe id")

// displayScale names, per Absolute Unit kind, the unit quantities accumulate in
// and the larger one to scale up to once there's enough of it. Deliberately
// only the thousand-fold step (gram->kilogram, millilitre->litre) that the
// Shopping List has always done: teaspoon and tablespoon are Absolute Units of
// the same kind, but nobody wants "50 g flour" rendered as tablespoons.
var displayScale = map[UnitKind]struct{ base, large string }{
	KindWeight: {base: "gram", large: "kilogram"},
	KindVolume: {base: "millilitre", large: "litre"},
}

// ingredientTotals accumulates one Ingredient's Amounts while combining.
type ingredientTotals struct {
	absolute map[UnitKind]float64 // summed in each kind's base unit
	relative map[string]float64   // summed per Relative Unit name - a tin and a pinch never merge
	verbatim []common.Amount      // quantities that couldn't be parsed, kept as-is
	// Department and RecipeID come from the first Ingredient Line seen for this
	// Ingredient. RecipeID recording only the first contributing Recipe is
	// pre-existing behaviour (and a latent defect noted in the spec), not
	// something this rewrite changes.
	department string
	recipeID   int
}

// CombineIngredients merges the Ingredient Lines of every given Recipe into one
// Ingredient Item per Ingredient, converting between Units where that's
// possible without knowing anything about the Ingredient itself.
//
// Two Amounts combine when both their Units are Absolute and of the same kind -
// so teaspoons combine with tablespoons, grams with kilograms. Everything else
// stays a separate Amount on the same Item: a Relative Unit's size depends on
// the Ingredient (one tin of what?), and until a later phase supplies a Unit
// Size there's no honest conversion to make. That's why the return carries a
// list of Amounts rather than one quantity - "50 g + 2 tbsp flour" is one line
// with one checkbox, not a guess and not a dropped ingredient.
//
// Pure by design: the unit catalog is a parameter, never a query, so this stays
// directly testable without a database (see the seam spec - a Go fake can't
// stand in for *sql.DB).
//
// Keyed by Ingredient name. `ingredient` has UNIQUE (name) (migration 002) and
// every name here was read back from that table, so name and id are bijective
// in this data; the old bug was that Unit wasn't part of the key at all.
func CombineIngredients(recipes []common.Recipe, units UnitCatalog) map[string]*common.ListIngredient {
	totals := make(map[string]*ingredientTotals)
	order := make([]string, 0)

	for _, recipe := range recipes {
		for _, line := range recipe.Ingredients {
			t, seen := totals[line.Name]
			if !seen {
				t = &ingredientTotals{
					absolute:   make(map[UnitKind]float64),
					relative:   make(map[string]float64),
					department: line.Department,
					recipeID:   recipe.ID,
				}
				totals[line.Name] = t
				order = append(order, line.Name)
			}
			if t.department == "" {
				t.department = line.Department
			}

			quantity, ok := ParseQuantity(line.Quantity)
			if !ok {
				// Unreadable, but the shopper still needs to know about it.
				t.verbatim = append(t.verbatim, common.Amount{
					Quantity: line.Quantity,
					Unit:     line.Unit,
				})
				continue
			}

			if info := units.Get(line.Unit); info.IsAbsolute() {
				t.absolute[info.Kind] += quantity * info.Factor
			} else {
				t.relative[line.Unit] += quantity
			}
		}
	}

	list := make(map[string]*common.ListIngredient, len(totals))
	for _, name := range order {
		t := totals[name]
		list[name] = &common.ListIngredient{
			Amounts:    t.amounts(units),
			IsBought:   false,
			Department: t.department,
			RecipeID:   t.recipeID,
		}
	}
	return list
}

// amounts renders the accumulated totals in a stable order: weight, then
// volume, then Relative Units alphabetically, then anything unparseable in the
// order it was read. Stable so the Shopping List doesn't reshuffle between
// regenerations, and so table tests aren't flaky.
func (t *ingredientTotals) amounts(units UnitCatalog) []common.Amount {
	amounts := make([]common.Amount, 0, len(t.absolute)+len(t.relative)+len(t.verbatim))

	for _, kind := range []UnitKind{KindWeight, KindVolume} {
		total, ok := t.absolute[kind]
		if !ok {
			continue
		}
		quantity, unit := scaleForDisplay(total, kind, units)
		amounts = append(amounts, common.Amount{Quantity: formatQuantity(quantity), Unit: unit})
	}

	relativeUnits := make([]string, 0, len(t.relative))
	for unit := range t.relative {
		relativeUnits = append(relativeUnits, unit)
	}
	sort.Strings(relativeUnits)
	for _, unit := range relativeUnits {
		amounts = append(amounts, common.Amount{
			Quantity: formatQuantity(t.relative[unit]),
			Unit:     unit,
		})
	}

	return append(amounts, t.verbatim...)
}

// scaleForDisplay converts a total held in a kind's base unit up to the larger
// unit once there's at least one of it - 1100 grams reads as 1.1 kilogram.
func scaleForDisplay(total float64, kind UnitKind, units UnitCatalog) (float64, string) {
	scale, ok := displayScale[kind]
	if !ok {
		return total, ""
	}
	large := units.Get(scale.large)
	if large.IsAbsolute() && large.Factor > 0 && total >= large.Factor {
		return total / large.Factor, scale.large
	}
	return total, scale.base
}

// GenerateShoppingList recomputes every Ingredient Item for the given set of Recipes and
// returns the refreshed Shopping List. This is a full replace, not an add: every
// existing Ingredient Item is discarded and recreated from this recipe set; Extra Items
// are untouched either way (see CONTEXT.md's "Generate Shopping List"). An Ingredient
// Item already marked bought carries that state forward if it's still present in the
// recomputed set, so regenerating the list doesn't silently un-buy things.
func GenerateShoppingList(recipeIDs []string, userID string, db *sql.DB) (*common.ShoppingList, error) {
	recipes := make([]common.Recipe, 0)
	for _, idStr := range recipeIDs {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			return nil, ErrInvalidRecipeID
		}
		recipe, err := GetRecipeByID(id, userID, db)
		if err != nil {
			return nil, err
		}
		recipes = append(recipes, *recipe)
	}

	previousIngredients, err := GetIngredientListItems(userID, db)
	if err != nil {
		return nil, err
	}

	// Loaded here and passed in, so CombineIngredients stays a pure function.
	units, err := GetUnitCatalog(db)
	if err != nil {
		return nil, err
	}

	combinedIngredients := CombineIngredients(recipes, units)
	for name, ingredient := range combinedIngredients {
		if previous, ok := previousIngredients[name]; ok && previous.IsBought {
			ingredient.IsBought = true
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if err := RemoveIngredientListItems(userID, tx); err != nil {
		return nil, err
	}
	if len(combinedIngredients) > 0 {
		if err := AddIngredientListItems(userID, combinedIngredients, tx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// Log shopping list history for meal planning intelligence, best-effort - a
	// logging failure shouldn't fail the whole generate operation.
	if intRecipeIDs, err := GetRecipeIDsFromStrings(recipeIDs); err == nil {
		if logErr := LogShoppingListEvent(userID, "add_recipe", intRecipeIDs, db); logErr != nil {
			log.Printf("Failed to log shopping list history: %v", logErr)
		}
	}

	return GetShoppingList(userID, db)
}

// GetShoppingList returns the full shopping list for a user
func GetShoppingList(userID string, db *sql.DB) (*common.ShoppingList, error) {
	recipes, err := GetRecipesFromList(userID, db)
	if err != nil {
		fmt.Println("could not get recipes from list")
		return nil, err
	}

	ingredients, err := GetIngredientListItems(userID, db)
	if err != nil {
		fmt.Println("could not get ingredients from list")
		return nil, err
	}

	extras, err := GetExtraListItems(userID, db)
	if err != nil {
		fmt.Println("could not get extra list items")
		return nil, err
	}

	list := &common.ShoppingList{
		Recipes:     recipes,
		Ingredients: ingredients,
		Extras:      extras,
	}

	return list, nil
}

// RemoveAllListItems removes all list items for a user
func RemoveAllListItems(userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	if _, err := db.Exec("DELETE FROM list WHERE account_id = ?;", accountID); err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// RemoveIngredientListItems removes all ingredient list items
func RemoveIngredientListItems(userID string, db dbConn) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	if _, err := db.Exec("DELETE FROM list WHERE account_id = ? AND type = 'ingredient';", accountID); err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// AddIngredientListItems adds passed ingredients to the db
func AddIngredientListItems(userID string, ingredients map[string]*common.ListIngredient, db dbConn) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not add ingredients to shopping list")
		return err
	}

	sqlStr := "INSERT INTO list(account_id, name, type, quantity, department, is_bought, recipe_id, unit_id) VALUES "
	vals := []interface{}{}

	// One row per Amount, so an Ingredient Item that couldn't be fully combined
	// writes several rows sharing a name. `list` has no unique constraint on
	// name and BuyListItem matches on name alone, so those rows already behave
	// as one checkbox - no schema change needed.
	for name, val := range ingredients {
		for _, amount := range val.Amounts {
			sqlStr += "(?, ?, 'ingredient', ?, ?, ?, ?, (SELECT id from unit where name=?)),"
			vals = append(vals, accountID, name, amount.Quantity, val.Department, val.IsBought, val.RecipeID, amount.Unit)
		}
	}

	// Every Ingredient Item could in principle have had no Amounts at all,
	// which would leave the statement as a bare INSERT ... VALUES.
	if len(vals) == 0 {
		return nil
	}

	sqlStr = sqlStr[0 : len(sqlStr)-1]
	if _, err := db.Exec(sqlStr, vals...); err != nil {
		fmt.Println(err)
		fmt.Println("could not add ingredients to shopping list")
		return err
	}
	return nil
}

// AddExtraListItem inserts an item of type 'extra'
func AddExtraListItem(userID string, name string, isBought bool, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	query := `
		INSERT INTO list
			(account_id, name, type, quantity, department, is_bought, unit_id)
			VALUES (?, ?, ?, ?, '', ?, ?)
	`
	if _, err := db.Exec(query, accountID, name, "extra", 0, isBought, 1); err != nil {
		return err
	}
	return nil
}

// GetRecipesFromList returns recipes used to create the shopping list
func GetRecipesFromList(userID string, db *sql.DB) ([]string, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}

	query := "SELECT DISTINCT recipe_id FROM list WHERE account_id = ? and type = 'ingredient';"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}

	recipes := make([]string, 0)
	for results.Next() {
		var recipe string
		err = results.Scan(&recipe)
		if err != nil {
			return nil, err
		}
		recipes = append(recipes, recipe)
	}
	return recipes, nil
}

// GetIngredientListItems returns items of type 'ingredient'
func GetIngredientListItems(userID string, db *sql.DB) (map[string]*common.ListIngredient, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}

	// ORDER BY list.id so an Ingredient Item's Amounts come back in the order
	// they were written, rather than whatever order the storage engine feels
	// like - otherwise "50 g + 2 tbsp" could render either way round between
	// requests.
	query := "SELECT list.name as name, unit.name as unit, quantity, department, is_bought as isBought FROM list INNER JOIN unit on unit_id = unit.id WHERE account_id = ? and type = 'ingredient' ORDER BY list.id;"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}
	defer results.Close()

	// Several rows can share a name - one per Amount - and collapse back into
	// one Ingredient Item here.
	ingredientList := make(map[string]*common.ListIngredient)
	for results.Next() {
		item := ListItem{}
		err = results.Scan(&item.Name, &item.Unit, &item.Quantity, &item.Department, &item.IsBought)
		if err != nil {
			return nil, err
		}
		existing, ok := ingredientList[item.Name]
		if !ok {
			existing = &common.ListIngredient{
				Amounts:    make([]common.Amount, 0, 1),
				Department: item.Department,
				IsBought:   item.IsBought,
			}
			ingredientList[item.Name] = existing
		}
		existing.Amounts = append(existing.Amounts, common.Amount{
			Quantity: item.Quantity,
			Unit:     item.Unit,
		})
	}
	if err := results.Err(); err != nil {
		return nil, err
	}

	return ingredientList, nil
}

// GetExtraListItems returns items of type 'extra'
func GetExtraListItems(userID string, db *sql.DB) (map[string]*common.ListIngredient, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}
	query := "SELECT list.name as name, is_bought as isBought FROM list WHERE account_id = ? and type = 'extra' ORDER BY list.id;"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}
	defer results.Close()

	// An Extra Item is a plain checklist entry - a name and a bought state. Its
	// row carries placeholder quantity/unit values (AddExtraListItem writes 0
	// and the blank unit sentinel) which have never meant anything, so they're
	// not read back and it carries no Amounts at all.
	extrasList := make(map[string]*common.ListIngredient)
	for results.Next() {
		var name string
		var isBought bool
		if err := results.Scan(&name, &isBought); err != nil {
			return nil, err
		}
		extrasList[name] = &common.ListIngredient{
			Amounts:  make([]common.Amount, 0),
			IsBought: isBought,
		}
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return extrasList, nil
}

// BuyListItem toggles the isBought state of a list item in the db
func BuyListItem(userID string, name string, isBought bool, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	if _, err := db.Exec("UPDATE list SET is_bought = ? WHERE name = ? AND account_id = ?", isBought, name, accountID); err != nil {
		return err
	}
	return nil
}
