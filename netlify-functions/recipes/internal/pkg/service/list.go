package service

import (
	"errors"
	"fmt"
	"log"
	"math"
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

// kindBaseUnit names the Unit each Absolute kind accumulates in, and scaleUpTo
// the larger Unit to switch to once there's at least one of it - 1100 grams
// reads as 1.1 kilogram. Deliberately only the thousand-fold step the Shopping
// List has always done: teaspoon and tablespoon are Absolute Units of the same
// kind, but nobody wants "50 g flour" rendered as tablespoons.
//
// Every base unit here has factor 1, which is what lets one number serve as
// both the scale-up threshold and the divisor.
var (
	kindBaseUnit = map[UnitKind]string{
		KindWeight: "gram",
		KindVolume: "millilitre",
	}
	scaleUpTo = map[string]string{
		"gram":       "kilogram",
		"millilitre": "litre",
	}
)

// baseTotal accumulates Amounts that could be reduced to a common Unit, while
// remembering whether they all came from a single Unit.
//
// That last part is why this isn't a bare float64. Converting is only worth
// doing when Units actually differ: "2 tablespoon + 2 teaspoon" has to pick a
// common unit and millilitres is the honest choice, but a lone "1 teaspoon
// cumin" was never ambiguous and should stay a teaspoon - and "3 onion" should
// stay a count rather than becoming 450 grams.
type baseTotal struct {
	total    float64
	soleUnit string
	seenAny  bool
	mixed    bool
}

func (b *baseTotal) add(unitName string, inBaseUnits float64) {
	b.total += inBaseUnits
	if !b.seenAny {
		b.soleUnit = unitName
		b.seenAny = true
	} else if b.soleUnit != unitName {
		b.mixed = true
	}
}

// sole reports the one Unit every contributing Amount used, if there was one.
// Returned as a second value rather than signalled by an empty string, because
// "" is itself a real Unit name - the bare-count sentinel ("2 eggs").
func (b *baseTotal) sole() (string, bool) {
	return b.soleUnit, b.seenAny && !b.mixed
}

// ingredientTotals accumulates one Ingredient's Amounts while combining.
type ingredientTotals struct {
	// baseKind is the dimension this Ingredient's Unit Sizes are expressed in -
	// weight for things bought by weight, volume for things bought by volume.
	// It's where a Relative Unit lands once a Unit Size makes it convertible.
	baseKind UnitKind
	// One total per Absolute kind. Amounts of a kind that isn't baseKind still
	// combine among themselves, which is what stops an uncurated Ingredient
	// losing the free conversions Phase 1 already gave it: teaspoons and
	// tablespoons combine whether or not anyone has said what a "packet" of the
	// thing weighs.
	byKind map[UnitKind]*baseTotal
	// Amounts whose Unit has no Unit Size for this Ingredient, so there's
	// nothing honest to convert them into. Summed per Unit name - two tins
	// combine with each other, but never with a pinch.
	unconvertible map[string]float64
	verbatim      []common.Amount // quantities that couldn't be parsed, kept as-is
	// Department is the first non-empty one seen (an Ingredient Line can arrive
	// without one). RecipeID is the first contributing Recipe - pre-existing
	// behaviour, and a latent defect noted in the spec, not changed here.
	department string
	recipeID   int
}

func (t *ingredientTotals) bucket(kind UnitKind) *baseTotal {
	b, ok := t.byKind[kind]
	if !ok {
		b = &baseTotal{}
		t.byKind[kind] = b
	}
	return b
}

// CombineIngredients merges the Ingredient Lines of every given Recipe into one
// Ingredient Item per Ingredient, converting between Units wherever it honestly
// can.
//
// Amounts combine when their Units share a dimension - grams with kilograms,
// teaspoons with tablespoons - which needs no knowledge of the Ingredient at
// all. On top of that, a Unit Size saying how big one of a Unit is for this
// particular Ingredient ("one tin of coconut milk is 400ml", "one onion is
// 150g") lets that Unit cross into the Ingredient's own dimension. Anything
// left stays a separate Amount on the same Item - one line, one checkbox,
// several Amounts - because inventing a conversion is worse than admitting
// there isn't one. See CONTEXT.md and docs/adr/0004, 0005.
//
// Pure by design: both catalogs are parameters, never queries, so this stays
// directly testable without a database (see the seam spec - a Go fake can't
// stand in for *sql.DB).
//
// Keyed by Ingredient name. `ingredient` has UNIQUE (name) (migration 002) and
// every name here was read back from that table, so name and id are bijective
// in this data; the original bug was that Unit wasn't part of the key at all.
func CombineIngredients(recipes []common.Recipe, units UnitCatalog, ingredients IngredientCatalog) map[string]*common.ListIngredient {
	totals := make(map[string]*ingredientTotals)

	for _, recipe := range recipes {
		for _, line := range recipe.Ingredients {
			info := ingredients.Get(line.Name)

			t, seen := totals[line.Name]
			if !seen {
				t = &ingredientTotals{
					baseKind:      units.Get(info.BaseUnit).Kind,
					byKind:        make(map[UnitKind]*baseTotal, 2),
					unconvertible: make(map[string]float64),
					department:    line.Department,
					recipeID:      recipe.ID,
				}
				totals[line.Name] = t
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

			unit := units.Get(line.Unit)
			size, sized := info.UnitSize(line.Unit, units)
			switch {
			case unit.IsAbsolute() && unit.Kind == t.baseKind:
				// Same dimension as the Ingredient's own: the Unit's factor is
				// enough, no per-ingredient knowledge needed.
				t.bucket(t.baseKind).add(line.Unit, quantity*unit.Factor)
			case sized:
				// A Unit Size carries it across into the Ingredient's dimension -
				// this is the density / pack size / average weight case, all one
				// mechanism.
				t.bucket(t.baseKind).add(line.Unit, quantity*size)
			case unit.IsAbsolute():
				if density, ok := info.UnitSize(kindBaseUnit[unit.Kind], units); ok {
					// A Unit Size on the *other* dimension's base unit is a
					// density ("one millilitre of flour is 0.53g"), and every
					// Unit of that dimension derives from it - so curating one
					// value covers teaspoon, tablespoon and millilitre at once
					// rather than needing a row each, which is both less work
					// and impossible to leave half-done.
					t.bucket(t.baseKind).add(line.Unit, quantity*unit.Factor*density)
					break
				}
				// Absolute but a different dimension, with no density to bridge
				// it. Still combines with its own kind, so tsp+tbsp merge even
				// when nothing has been curated for this Ingredient.
				t.bucket(unit.Kind).add(line.Unit, quantity*unit.Factor)
			default:
				t.unconvertible[line.Unit] += quantity
			}
		}
	}

	list := make(map[string]*common.ListIngredient, len(totals))
	for name, t := range totals {
		list[name] = &common.ListIngredient{
			Amounts:    t.amounts(units, ingredients.Get(name)),
			IsBought:   false,
			Department: t.department,
			RecipeID:   t.recipeID,
		}
	}
	return list
}

// amounts renders one Ingredient's accumulated totals in a stable order: weight,
// then volume, then whatever couldn't be converted (alphabetically by Unit),
// then anything unparseable in the order it was read. Stable so an Item's
// Amounts don't reshuffle between regenerations, and so table tests aren't
// flaky. (Ordering *between* Items isn't this function's business - the Shopping
// List is a map, and the frontend sorts by Department.)
func (t *ingredientTotals) amounts(units UnitCatalog, info IngredientInfo) []common.Amount {
	amounts := make([]common.Amount, 0, len(t.byKind)+len(t.unconvertible)+len(t.verbatim))

	for _, kind := range []UnitKind{KindWeight, KindVolume} {
		if b, ok := t.byKind[kind]; ok && b.seenAny {
			amounts = append(amounts, t.kindAmount(kind, b, units, info))
		}
	}

	unconverted := make([]string, 0, len(t.unconvertible))
	for unit := range t.unconvertible {
		unconverted = append(unconverted, unit)
	}
	sort.Strings(unconverted)
	for _, unit := range unconverted {
		amounts = append(amounts, common.Amount{
			Quantity: formatQuantity(t.unconvertible[unit]),
			Unit:     unit,
		})
	}

	return append(amounts, t.verbatim...)
}

// kindAmount renders one kind's combined total as the single Amount a shopper
// reads.
//
// When every contributing Ingredient Line used the same Unit there was never
// any ambiguity, so that Unit is kept: "1 teaspoon cumin" stays a teaspoon
// rather than becoming "5 millilitre", and "3 onion" stays a count rather than
// becoming "450 gram". Only genuinely mixed Units fall back to the base Unit,
// which is the honest common denominator.
//
// Either way the thousand-fold scale-up still applies, so 1100 grams reads as
// 1.1 kilogram exactly as it always has.
func (t *ingredientTotals) kindAmount(kind UnitKind, b *baseTotal, units UnitCatalog, info IngredientInfo) common.Amount {
	base := kindBaseUnit[kind]

	large, canScaleUp := "", false
	if name, ok := scaleUpTo[base]; ok {
		if u := units.Get(name); u.IsAbsolute() && u.Factor > 0 && b.total >= u.Factor {
			large, canScaleUp = name, true
		}
	}

	if sole, only := b.sole(); only && !(sole == base && canScaleUp) {
		if divisor, ok := divisorFor(sole, kind, units, info); ok {
			return common.Amount{Quantity: formatQuantity(b.total / divisor), Unit: sole}
		}
	}

	if canScaleUp {
		return common.Amount{
			Quantity: formatQuantity(b.total / units.Get(large).Factor),
			Unit:     large,
		}
	}
	return common.Amount{Quantity: formatQuantity(b.total), Unit: base}
}

// divisorFor is how many base units one of the given Unit is - the number that
// converts an accumulated total back out for display.
//
// The density branch matters more than it looks: without it, sole-unit
// preservation silently fails for any Ingredient that has one. A lone
// "1 tablespoon chilli powder" would convert *into* grams to be summed and
// then find no way back, rendering "7.5 gram" for a line that was never
// ambiguous - the same regression the Phase 1 review caught, arriving by a
// different route.
func divisorFor(unit string, kind UnitKind, units UnitCatalog, info IngredientInfo) (float64, bool) {
	u := units.Get(unit)
	if u.IsAbsolute() && u.Kind == kind && u.Factor > 0 {
		return u.Factor, true
	}
	if size, ok := info.UnitSize(unit, units); ok {
		return size, true
	}
	// Crossed dimensions on the way in via a density, so it has to come back
	// out the same way.
	if u.IsAbsolute() && u.Factor > 0 {
		if density, ok := info.UnitSize(kindBaseUnit[u.Kind], units); ok {
			return u.Factor * density, true
		}
	}
	return 0, false
}

// ApplyDisplayUnits rewrites each Ingredient Item's Amounts into the
// Ingredient's Display Unit where it has one, keeping the amount it was added
// up in alongside: "2 tins" carries "800 gram".
//
// Applied when the Shopping List is read rather than when it's generated, so a
// corrected Unit Size or Display Unit improves a list that's already sitting in
// the database - the same read-time principle that keeps `part` verbatim.
// Pure: both catalogs are parameters.
func ApplyDisplayUnits(items map[string]*common.ListIngredient, units UnitCatalog, ingredients IngredientCatalog) {
	for name, item := range items {
		info := ingredients.Get(name)
		if !info.HasDisplayUnit {
			continue
		}
		display, ok := unitsPerBase(info.DisplayUnit, units, info)
		if !ok {
			continue
		}
		for i, amount := range item.Amounts {
			if amount.Unit == info.DisplayUnit {
				continue
			}
			base, ok := amountInBaseUnits(amount, units, info)
			if !ok {
				// Nothing to convert from - an unparseable quantity, or a Unit
				// with no Unit Size. Left exactly as it is.
				continue
			}
			item.Amounts[i] = common.Amount{
				Quantity:     formatDisplayQuantity(base/display, info.DisplayUnit, units),
				Unit:         info.DisplayUnit,
				BaseQuantity: amount.Quantity,
				BaseUnit:     amount.Unit,
			}
		}
	}
}

// amountInBaseUnits reduces a rendered Amount back to the Ingredient's Base
// Unit, reporting false when there's no honest way to.
func amountInBaseUnits(amount common.Amount, units UnitCatalog, info IngredientInfo) (float64, bool) {
	quantity, ok := ParseQuantity(amount.Quantity)
	if !ok {
		return 0, false
	}
	per, ok := unitsPerBase(amount.Unit, units, info)
	if !ok {
		return 0, false
	}
	return quantity * per, true
}

// unitsPerBase is how many Base Units one of the given Unit is worth - its
// factor when it shares the Base Unit's dimension, otherwise its Unit Size.
func unitsPerBase(unit string, units UnitCatalog, info IngredientInfo) (float64, bool) {
	baseKind := units.Get(info.BaseUnit).Kind
	u := units.Get(unit)
	if u.IsAbsolute() && u.Kind == baseKind && u.Factor > 0 {
		return u.Factor, true
	}
	if size, ok := info.UnitSize(unit, units); ok {
		return size, true
	}
	// Cross-dimension: derive from the Ingredient's density, if it has one.
	if u.IsAbsolute() && u.Factor > 0 {
		if density, ok := info.UnitSize(kindBaseUnit[u.Kind], units); ok {
			return u.Factor * density, true
		}
	}
	return 0, false
}

// formatDisplayQuantity rounds a converted total for display.
//
// A Relative Display Unit rounds **up to a whole**: you can't buy 1.5 tins or
// 1.5 chicken breasts, so a fraction is never a purchasable instruction, and
// rounding up means the cook is never left short. An Absolute one keeps its
// natural precision - nobody wants weights rounded to half a kilo.
func formatDisplayQuantity(quantity float64, unit string, units UnitCatalog) string {
	if units.Get(unit).IsAbsolute() {
		return formatQuantity(quantity)
	}
	whole := math.Ceil(math.Round(quantity*1e6) / 1e6)
	if whole < 1 {
		whole = 1
	}
	return formatQuantity(whole)
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
	ingredientCatalog, err := GetIngredientCatalog(db, units)
	if err != nil {
		return nil, err
	}

	combinedIngredients := CombineIngredients(recipes, units, ingredientCatalog)
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

	// Display Units are applied here rather than when the list is generated, so
	// correcting a Unit Size or Display Unit improves a Shopping List that's
	// already been generated. Extras carry no Amounts, so they're untouched.
	units, err := GetUnitCatalog(db)
	if err != nil {
		return nil, err
	}
	ingredientCatalog, err := GetIngredientCatalog(db, units)
	if err != nil {
		return nil, err
	}
	ApplyDisplayUnits(ingredients, units, ingredientCatalog)

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
	defer results.Close()

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
