package service

import (
	"recipes/internal/pkg/common"
	"testing"
)

// The Shopping List groups store-cupboard basics away instead of Recipe Import
// dropping them, so what reaches the shopper has to be *marked*, never missing -
// the whole point being that a shopper can tell "we grouped this" apart from
// "we lost this" (migration 032).
func TestMarkPantryStaples(t *testing.T) {
	catalog := IngredientCatalog{
		"olive oil": {BaseUnit: "millilitre", PantryStaple: true},
		"salt":      {BaseUnit: "gram", PantryStaple: true},
		"onion":     {BaseUnit: "gram", DisplayUnit: "", HasDisplayUnit: true},
	}

	list := map[string]*common.ListIngredient{
		"olive oil":     {Amounts: []common.Amount{amount("30", "millilitre")}},
		"salt":          {Amounts: []common.Amount{amount("1", "pinch")}},
		"onion":         {Amounts: []common.Amount{amount("2", "")}},
		"jerk marinade": {Amounts: []common.Amount{amount("120", "millilitre")}},
	}

	MarkPantryStaples(list, catalog)

	want := map[string]bool{
		"olive oil":     true,
		"salt":          true,
		"onion":         false,
		"jerk marinade": false, // not in the catalog at all
	}
	for name, expected := range want {
		if got := list[name].PantryStaple; got != expected {
			t.Errorf("%s: expected PantryStaple %v but got %v", name, expected, got)
		}
	}
}

// Grouping is presentation. An Amount that reaches the shopper must be the same
// number whether or not the Ingredient happens to be a staple - if flagging
// something changed what you were told to buy, the flag would be a bug rather
// than a view.
func TestMarkPantryStaplesLeavesAmountsAlone(t *testing.T) {
	list := items("olive oil", amount("30", "millilitre"), amount("2", "tablespoon"))
	before := append([]common.Amount(nil), list["olive oil"].Amounts...)

	MarkPantryStaples(list, IngredientCatalog{"olive oil": {BaseUnit: "millilitre", PantryStaple: true}})

	got := list["olive oil"].Amounts
	if len(got) != len(before) {
		t.Fatalf("expected %d amounts but got %d", len(before), len(got))
	}
	for i := range before {
		if got[i] != before[i] {
			t.Errorf("amount %d: expected %v but got %v", i, before[i], got[i])
		}
	}
}

// Every Item is written on each pass, not only the staples. Otherwise an
// Ingredient un-flagged in the catalog would keep a stale true from whatever
// the caller had already put on the struct.
func TestMarkPantryStaplesClearsAStaleFlag(t *testing.T) {
	list := map[string]*common.ListIngredient{
		"cumin": {Amounts: []common.Amount{amount("1", "teaspoon")}, PantryStaple: true},
	}

	MarkPantryStaples(list, IngredientCatalog{})

	if list["cumin"].PantryStaple {
		t.Error("expected an ingredient absent from the catalog not to be a pantry staple")
	}
}
