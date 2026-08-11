package service

import (
	"context"
	"database/sql"
)

// DefaultBaseUnit is what an Ingredient with no Base Unit set normalises to.
// Most things are bought by weight, so gram is the useful default and only the
// liquids need an explicit value.
const DefaultBaseUnit = "gram"

// IngredientInfo is what combining a Shopping List needs to know about one
// Ingredient: what to add its Amounts up in, and how big one of any Unit is
// for this particular Ingredient.
//
// Internal to aggregation, so deliberately not in `common` - none of it
// appears in an API response.
type IngredientInfo struct {
	// DisplayUnit is the Unit combined totals are shown in, which is often not
	// the one they're added up in - you buy tinned tomatoes in tins and onions
	// by the onion. Never affects arithmetic.
	//
	// HasDisplayUnit is separate rather than signalled by an empty DisplayUnit,
	// because "" is itself a real Unit - the bare-count sentinel, and one of the
	// most useful Display Units there is ("6 onions"). Overloading the empty
	// string here would silently mean "show onions in grams".
	DisplayUnit    string
	HasDisplayUnit bool
	// BaseUnit is always an Absolute Unit with factor 1 (gram or millilitre) -
	// see GetIngredientCatalog, which falls back to gram rather than trusting a
	// row that says otherwise.
	BaseUnit string
	// UnitSizes maps a Unit name to how much one of it is, in BaseUnit. Missing
	// is a normal state: that Unit's Amounts simply won't combine yet.
	UnitSizes map[string]float64
	// PantryStaple marks a store-cupboard basic the Shopping List groups away by
	// default. Purely presentational - it never affects combining or arithmetic,
	// which is the whole point of moving the judgement here from Recipe Import
	// (migration 032).
	PantryStaple bool
}

// IngredientCatalog maps an Ingredient's name to its measurement metadata.
// Keyed by name for the same reason CombineIngredients is: `ingredient` has
// UNIQUE (name) (migration 002) and every name the aggregator sees was read
// back from that table.
type IngredientCatalog map[string]IngredientInfo

// Get returns what's known about an Ingredient, defaulting to "adds up in
// grams, no Unit Sizes" for one nothing has been curated for. That default is
// what makes an uncurated Ingredient behave exactly as it did before any of
// this existed: Absolute weights still combine, everything else stays a
// separate Amount.
func (c IngredientCatalog) Get(name string) IngredientInfo {
	if info, ok := c[name]; ok {
		return info
	}
	return IngredientInfo{BaseUnit: DefaultBaseUnit}
}

// UnitSize returns how much one of the given Unit of this Ingredient is, in the
// Ingredient's Base Unit. It prefers a value curated for this specific
// Ingredient and falls back to the Unit's own default, which only exists for
// Units whose size genuinely doesn't vary by Ingredient (a pinch, a clove).
func (i IngredientInfo) UnitSize(unit string, units UnitCatalog) (float64, bool) {
	if size, ok := i.UnitSizes[unit]; ok && size > 0 {
		return size, true
	}
	if def := units.Get(unit).DefaultSize; def > 0 {
		return def, true
	}
	return 0, false
}

// GetIngredientCatalog loads every Ingredient's Base Unit and Unit Sizes in two
// queries, for passing into CombineIngredients - which stays pure and never
// queries for itself.
//
// Only Ingredients with something curated appear; IngredientCatalog.Get
// supplies the default for everything else, so this doesn't need a row per
// Ingredient just to say "nothing set".
func GetIngredientCatalog(ctx context.Context, db *sql.DB, units UnitCatalog) (IngredientCatalog, error) {
	catalog := make(IngredientCatalog)

	baseUnits, err := db.QueryContext(ctx, `
		SELECT ingredient.name, base.name, display.name, ingredient.pantry_staple
		FROM ingredient
		LEFT JOIN unit AS base ON base.id = ingredient.base_unit_id
		LEFT JOIN unit AS display ON display.id = ingredient.display_unit_id
		WHERE ingredient.base_unit_id IS NOT NULL
		   OR ingredient.display_unit_id IS NOT NULL
		   OR ingredient.pantry_staple;
	`)
	if err != nil {
		return nil, err
	}
	defer baseUnits.Close()

	for baseUnits.Next() {
		var ingredient string
		var base, display sql.NullString
		var pantryStaple bool
		if err := baseUnits.Scan(&ingredient, &base, &display, &pantryStaple); err != nil {
			return nil, err
		}
		baseUnit := base.String
		if !base.Valid {
			baseUnit = DefaultBaseUnit
		}
		// A Base Unit has to be something quantities can actually be summed in.
		// Anything else - a Relative Unit, or an Absolute one that isn't its
		// dimension's base - would make every stored Unit Size ambiguous, so
		// fall back to gram rather than compute against it.
		if info := units.Get(baseUnit); !info.IsAbsolute() || info.Factor != 1 {
			baseUnit = DefaultBaseUnit
		}
		catalog[ingredient] = IngredientInfo{
			BaseUnit:       baseUnit,
			DisplayUnit:    display.String,
			HasDisplayUnit: display.Valid,
			PantryStaple:   pantryStaple,
		}
	}
	if err := baseUnits.Err(); err != nil {
		return nil, err
	}

	sizes, err := db.QueryContext(ctx, `
		SELECT ingredient.name, unit.name, ingredient_unit_size.size
		FROM ingredient_unit_size
		INNER JOIN ingredient ON ingredient.id = ingredient_unit_size.ingredient_id
		INNER JOIN unit ON unit.id = ingredient_unit_size.unit_id;
	`)
	if err != nil {
		return nil, err
	}
	defer sizes.Close()

	for sizes.Next() {
		var ingredient, unit string
		var size float64
		if err := sizes.Scan(&ingredient, &unit, &size); err != nil {
			return nil, err
		}
		info, ok := catalog[ingredient]
		if !ok {
			info = IngredientInfo{BaseUnit: DefaultBaseUnit}
		}
		if info.UnitSizes == nil {
			info.UnitSizes = make(map[string]float64)
		}
		info.UnitSizes[unit] = size
		catalog[ingredient] = info
	}
	if err := sizes.Err(); err != nil {
		return nil, err
	}

	return catalog, nil
}
