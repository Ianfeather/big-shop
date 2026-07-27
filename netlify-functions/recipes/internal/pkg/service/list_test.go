package service

import (
	"recipes/internal/pkg/common"
	"reflect"
	"testing"
)

// testUnits mirrors the classification migration 019 applies to the real unit
// table: the six Absolute Units carry a kind and a factor into their
// dimension's base, everything else is Relative.
func testUnits() UnitCatalog {
	return UnitCatalog{
		"gram":       {Kind: KindWeight, Factor: 1},
		"kilogram":   {Kind: KindWeight, Factor: 1000},
		"millilitre": {Kind: KindVolume, Factor: 1},
		"litre":      {Kind: KindVolume, Factor: 1000},
		"teaspoon":   {Kind: KindVolume, Factor: 5},
		"tablespoon": {Kind: KindVolume, Factor: 15},
		"tin":        {Kind: KindRelative},
		"pinch":      {Kind: KindRelative},
		"":           {Kind: KindRelative},
	}
}

func lines(ls ...common.Ingredient) []common.Recipe {
	return []common.Recipe{{ID: 1, Ingredients: ls}}
}

func ingredient(name, quantity, unit string) common.Ingredient {
	return common.Ingredient{Name: name, Quantity: quantity, Unit: unit}
}

func TestCombineIngredients(t *testing.T) {
	tests := []struct {
		name    string
		recipes []common.Recipe
		// Both default to "nothing curated" when nil, which is the state every
		// Ingredient is in until Phase 2's seed lands - and the state most of
		// these cases are asserting.
		units       UnitCatalog
		ingredients IngredientCatalog
		want        map[string][]common.Amount
	}{
		// The bug this whole change exists to fix. Quantities used to be summed
		// keyed by ingredient name with Unit not part of the key at all, so
		// these two silently became "11" of whichever unit came first.
		{
			name: "tablespoon and gram of the same ingredient do not silently sum",
			recipes: lines(
				ingredient("garlic", "1", "tablespoon"),
				ingredient("garlic", "10", "gram"),
			),
			// Each side keeps its own Unit: neither was ambiguous on its own, and
			// there's nothing to convert between weight and volume without a
			// density. What matters is that they are two Amounts, not "11".
			want: map[string][]common.Amount{
				"garlic": {{Quantity: "10", Unit: "gram"}, {Quantity: "1", Unit: "tablespoon"}},
			},
		},

		// A line that was never ambiguous must not be rewritten. Converting to
		// the base unit is only worth doing when Units actually differ.
		{
			name:    "a single unit is preserved rather than converted to the base unit",
			recipes: lines(ingredient("cumin", "1", "teaspoon")),
			want: map[string][]common.Amount{
				"cumin": {{Quantity: "1", Unit: "teaspoon"}},
			},
		},
		{
			name: "several lines sharing one unit keep that unit",
			recipes: lines(
				ingredient("olive oil", "2", "tablespoon"),
				ingredient("olive oil", "3", "tablespoon"),
			),
			want: map[string][]common.Amount{
				"olive oil": {{Quantity: "5", Unit: "tablespoon"}},
			},
		},
		{
			name: "a single non-base unit still scales by its own factor",
			recipes: lines(
				ingredient("stock", "5", "litre"),
				ingredient("stock", "1", "litre"),
			),
			want: map[string][]common.Amount{
				"stock": {{Quantity: "6", Unit: "litre"}},
			},
		},

		// Same dimension, pure conversion - the 18 ingredients in the real data
		// that need no per-ingredient information at all.
		{
			name: "teaspoon and tablespoon combine as volume",
			recipes: lines(
				ingredient("soy sauce", "2", "tablespoon"),
				ingredient("soy sauce", "2", "teaspoon"),
			),
			want: map[string][]common.Amount{
				"soy sauce": {{Quantity: "40", Unit: "millilitre"}},
			},
		},
		{
			name: "gram and kilogram combine and scale up",
			recipes: lines(
				ingredient("mince", "500", "gram"),
				ingredient("mince", "1", "kilogram"),
				ingredient("mince", "200", "gram"),
			),
			want: map[string][]common.Amount{
				"mince": {{Quantity: "1.7", Unit: "kilogram"}},
			},
		},
		{
			name: "millilitre and litre combine and scale up",
			recipes: lines(
				ingredient("milk", "500", "millilitre"),
				ingredient("milk", "600", "millilitre"),
			),
			want: map[string][]common.Amount{
				"milk": {{Quantity: "1.1", Unit: "litre"}},
			},
		},
		{
			name:    "below the scale-up threshold it stays in the base unit",
			recipes: lines(ingredient("flour", "999", "gram")),
			want: map[string][]common.Amount{
				"flour": {{Quantity: "999", Unit: "gram"}},
			},
		},

		// No conversion is possible without a Unit Size, so both Amounts survive
		// on one Item rather than one being dropped or a number invented.
		{
			name: "weight and a relative unit stay as separate amounts",
			recipes: lines(
				ingredient("chopped tomatoes", "2", "tin"),
				ingredient("chopped tomatoes", "200", "gram"),
			),
			want: map[string][]common.Amount{
				"chopped tomatoes": {{Quantity: "200", Unit: "gram"}, {Quantity: "2", Unit: "tin"}},
			},
		},
		// count<->weight: 12 ingredients in the real data (potato, red onion,
		// chicken breast...). Merging these needs an average weight, which is a
		// Unit Size and therefore Phase 2 - for now they stay honest.
		{
			name: "a bare count and a weight stay separate until there is a Unit Size",
			recipes: lines(
				ingredient("potato", "3", ""),
				ingredient("potato", "500", "gram"),
			),
			want: map[string][]common.Amount{
				"potato": {{Quantity: "500", Unit: "gram"}, {Quantity: "3", Unit: ""}},
			},
		},
		// count<->volume: 8 ingredients in the real data.
		{
			name: "a bare count and a volume stay separate",
			recipes: lines(
				ingredient("white wine", "1", ""),
				ingredient("white wine", "250", "millilitre"),
			),
			want: map[string][]common.Amount{
				"white wine": {{Quantity: "250", Unit: "millilitre"}, {Quantity: "1", Unit: ""}},
			},
		},
		// weight<->volume: 16 ingredients, the largest category needing data.
		// Merging these needs a density, which is also a Unit Size (ADR-0004).
		{
			name: "weight and volume stay separate without a density",
			recipes: lines(
				ingredient("flour", "50", "gram"),
				ingredient("flour", "2", "tablespoon"),
			),
			want: map[string][]common.Amount{
				"flour": {{Quantity: "50", Unit: "gram"}, {Quantity: "2", Unit: "tablespoon"}},
			},
		},
		{
			name: "two different relative units never merge with each other",
			recipes: lines(
				ingredient("parsley", "1", "tin"),
				ingredient("parsley", "3", "pinch"),
			),
			want: map[string][]common.Amount{
				"parsley": {{Quantity: "3", Unit: "pinch"}, {Quantity: "1", Unit: "tin"}},
			},
		},
		{
			name: "the same relative unit does accumulate",
			recipes: lines(
				ingredient("coconut milk", "1", "tin"),
				ingredient("coconut milk", "2", "tin"),
			),
			want: map[string][]common.Amount{
				"coconut milk": {{Quantity: "3", Unit: "tin"}},
			},
		},
		{
			name: "the blank count sentinel accumulates as its own amount",
			recipes: lines(
				ingredient("egg", "2", ""),
				ingredient("egg", "3", ""),
			),
			want: map[string][]common.Amount{
				"egg": {{Quantity: "5", Unit: ""}},
			},
		},
		// Recipe Import can invent a Unit at any time. Unknown means Relative,
		// which is safe: it simply doesn't combine.
		{
			name: "an unknown unit is treated as relative rather than dropped",
			recipes: lines(
				ingredient("thyme", "2", "sprig"),
				ingredient("thyme", "5", "gram"),
			),
			want: map[string][]common.Amount{
				"thyme": {{Quantity: "5", Unit: "gram"}, {Quantity: "2", Unit: "sprig"}},
			},
		},

		// The second defect fixed here: an unparseable quantity used to be
		// swallowed by an `if err == nil` with no else and vanish entirely.
		{
			name: "an unparseable quantity is kept verbatim, not dropped",
			recipes: lines(
				ingredient("parsley", "a handful", "gram"),
				ingredient("parsley", "20", "gram"),
			),
			want: map[string][]common.Amount{
				"parsley": {{Quantity: "20", Unit: "gram"}, {Quantity: "a handful", Unit: "gram"}},
			},
		},
		{
			name:    "an ingredient with only an unparseable quantity still appears",
			recipes: lines(ingredient("salt", "to taste", "")),
			want: map[string][]common.Amount{
				"salt": {{Quantity: "to taste", Unit: ""}},
			},
		},
		// "0" parses fine, so it must contribute nothing rather than being
		// treated as unreadable and printed verbatim beside the real total.
		{
			name: "a zero quantity adds nothing instead of becoming a verbatim amount",
			recipes: lines(
				ingredient("pepper", "0", "gram"),
				ingredient("pepper", "5", "gram"),
			),
			want: map[string][]common.Amount{
				"pepper": {{Quantity: "5", Unit: "gram"}},
			},
		},
		// A negative would silently subtract, so it stays visible instead.
		{
			name: "a negative quantity is surfaced verbatim rather than subtracting",
			recipes: lines(
				ingredient("sugar", "-5", "gram"),
				ingredient("sugar", "100", "gram"),
			),
			want: map[string][]common.Amount{
				"sugar": {{Quantity: "100", Unit: "gram"}, {Quantity: "-5", Unit: "gram"}},
			},
		},

		{
			name:    "fractions and mixed numbers parse",
			recipes: lines(ingredient("butter", "1 1/2", "tablespoon"), ingredient("butter", "1/2", "tablespoon")),
			// Both lines are tablespoons, so the total stays in tablespoons.
			want: map[string][]common.Amount{
				"butter": {{Quantity: "2", Unit: "tablespoon"}},
			},
		},

		// --- Phase 2: with curated data, the categories above start merging ---

		// count<->measure, the largest category in live data (32 ingredients,
		// including onion, potato, carrot and lemon).
		{
			name: "a count merges into weight once an average weight is known",
			recipes: lines(
				ingredient("onion", "3", ""),
				ingredient("onion", "150", "gram"),
			),
			ingredients: IngredientCatalog{
				"onion": {BaseUnit: "gram", UnitSizes: map[string]float64{"": 150}},
			},
			want: map[string][]common.Amount{
				"onion": {{Quantity: "600", Unit: "gram"}},
			},
		},
		// The same rule that keeps a lone teaspoon a teaspoon has to keep a lone
		// count a count - otherwise "3 onions" becomes "450 gram" for no reason.
		{
			name:    "a lone count is not converted just because a Unit Size exists",
			recipes: lines(ingredient("onion", "3", "")),
			ingredients: IngredientCatalog{
				"onion": {BaseUnit: "gram", UnitSizes: map[string]float64{"": 150}},
			},
			want: map[string][]common.Amount{
				"onion": {{Quantity: "3", Unit: ""}},
			},
		},
		// weight<->volume, via a density expressed as a Unit Size.
		{
			name: "a density merges volume into weight",
			recipes: lines(
				ingredient("flour", "50", "gram"),
				ingredient("flour", "2", "tablespoon"),
			),
			ingredients: IngredientCatalog{
				"flour": {BaseUnit: "gram", UnitSizes: map[string]float64{"tablespoon": 8}},
			},
			want: map[string][]common.Amount{
				"flour": {{Quantity: "66", Unit: "gram"}},
			},
		},
		// A pack size, on an Ingredient whose Base Unit is millilitre - the same
		// "tin = 400" reads as 400ml here and would be 400g for tinned tomatoes.
		{
			name: "a pack size merges into a millilitre base unit",
			recipes: lines(
				ingredient("coconut milk", "1", "tin"),
				ingredient("coconut milk", "400", "millilitre"),
			),
			ingredients: IngredientCatalog{
				"coconut milk": {BaseUnit: "millilitre", UnitSizes: map[string]float64{"tin": 400}},
			},
			want: map[string][]common.Amount{
				"coconut milk": {{Quantity: "800", Unit: "millilitre"}},
			},
		},
		// A Unit whose size genuinely doesn't vary by Ingredient can carry a
		// default on the Unit itself rather than being repeated per Ingredient.
		{
			name: "a Unit's default size is used when the Ingredient has none",
			recipes: lines(
				ingredient("black pepper", "2", "pinch"),
				ingredient("black pepper", "4", "gram"),
			),
			units: func() UnitCatalog {
				u := testUnits()
				u["pinch"] = UnitInfo{Kind: KindRelative, DefaultSize: 0.5}
				return u
			}(),
			want: map[string][]common.Amount{
				"black pepper": {{Quantity: "5", Unit: "gram"}},
			},
		},
		// A value curated for the specific Ingredient always beats the default.
		{
			name: "a per-Ingredient Unit Size overrides the Unit's default",
			recipes: lines(
				ingredient("saffron", "2", "pinch"),
				ingredient("saffron", "1", "gram"),
			),
			units: func() UnitCatalog {
				u := testUnits()
				u["pinch"] = UnitInfo{Kind: KindRelative, DefaultSize: 0.5}
				return u
			}(),
			ingredients: IngredientCatalog{
				"saffron": {BaseUnit: "gram", UnitSizes: map[string]float64{"pinch": 0.1}},
			},
			want: map[string][]common.Amount{
				"saffron": {{Quantity: "1.2", Unit: "gram"}},
			},
		},
		// Curating one Unit doesn't silently make the others convertible.
		{
			name: "units without a Unit Size still stay separate",
			recipes: lines(
				ingredient("parsley", "30", "gram"),
				ingredient("parsley", "1", "packet"),
				ingredient("parsley", "2", "tablespoon"),
			),
			ingredients: IngredientCatalog{
				"parsley": {BaseUnit: "gram", UnitSizes: map[string]float64{"tablespoon": 4}},
			},
			want: map[string][]common.Amount{
				"parsley": {{Quantity: "38", Unit: "gram"}, {Quantity: "1", Unit: "packet"}},
			},
		},

		{
			name: "ingredients combine across recipes",
			recipes: []common.Recipe{
				{ID: 1, Ingredients: []common.Ingredient{ingredient("onion", "2", "")}},
				{ID: 2, Ingredients: []common.Ingredient{ingredient("onion", "1", "")}},
			},
			want: map[string][]common.Amount{
				"onion": {{Quantity: "3", Unit: ""}},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			units := tc.units
			if units == nil {
				units = testUnits()
			}
			got := CombineIngredients(tc.recipes, units, tc.ingredients)

			if len(got) != len(tc.want) {
				t.Fatalf("expected %d ingredients but got %d (%v)", len(tc.want), len(got), got)
			}
			for name, wantAmounts := range tc.want {
				item, ok := got[name]
				if !ok {
					t.Fatalf("expected an item named %q, got %v", name, got)
				}
				if !reflect.DeepEqual(item.Amounts, wantAmounts) {
					t.Errorf("%q: expected %v but got %v", name, wantAmounts, item.Amounts)
				}
			}
		})
	}
}

func TestCombineIngredientsCarriesDepartmentAndRecipe(t *testing.T) {
	recipes := []common.Recipe{
		{ID: 7, Ingredients: []common.Ingredient{
			{Name: "carrot", Quantity: "2", Unit: "", Department: "vegetables"},
		}},
		{ID: 9, Ingredients: []common.Ingredient{
			{Name: "carrot", Quantity: "1", Unit: "", Department: "vegetables"},
		}},
	}

	got := CombineIngredients(recipes, testUnits(), nil)["carrot"]

	if got.Department != "vegetables" {
		t.Errorf("expected department %q but got %q", "vegetables", got.Department)
	}
	// First contributing Recipe wins - pre-existing behaviour, not changed here.
	if got.RecipeID != 7 {
		t.Errorf("expected recipe id 7 but got %d", got.RecipeID)
	}
	if got.IsBought {
		t.Error("a freshly combined item should not be marked bought")
	}
}

func TestCombineIngredientsEmptyInput(t *testing.T) {
	got := CombineIngredients([]common.Recipe{}, testUnits(), nil)
	if len(got) != 0 {
		t.Errorf("expected no ingredients but got %v", got)
	}
}

// A Unit Size on the other dimension's base unit is a density, and every Unit
// of that dimension derives from it - so one curated value covers millilitre,
// teaspoon and tablespoon rather than needing a row each.
func TestCombineIngredientsDerivesVolumeUnitsFromDensity(t *testing.T) {
	recipes := lines(
		ingredient("plain flour", "100", "gram"),
		ingredient("plain flour", "2", "tablespoon"), // 30ml
		ingredient("plain flour", "1", "teaspoon"),   // 5ml
	)
	catalog := IngredientCatalog{
		"plain flour": {BaseUnit: "gram", UnitSizes: map[string]float64{"millilitre": 0.53}},
	}

	got := CombineIngredients(recipes, testUnits(), catalog)["plain flour"].Amounts

	// 100g + 30ml*0.53 + 5ml*0.53 = 100 + 15.9 + 2.65
	want := []common.Amount{{Quantity: "118.55", Unit: "gram"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected %v but got %v", want, got)
	}
}

// A lone Amount stays in its own Unit even when a density exists for the
// Ingredient. Converting into the base unit to sum it is fine; failing to
// convert back is not - "1 tablespoon chilli powder" is not "7.5 gram".
func TestCombineIngredientsPreservesASoleUnitDespiteADensity(t *testing.T) {
	catalog := IngredientCatalog{
		"chilli powder": {BaseUnit: "gram", UnitSizes: map[string]float64{"millilitre": 0.5}},
	}

	for _, tc := range []struct {
		name    string
		recipes []common.Recipe
		want    []common.Amount
	}{
		{"lone tablespoon", lines(ingredient("chilli powder", "1", "tablespoon")),
			[]common.Amount{{Quantity: "1", Unit: "tablespoon"}}},
		{"several tablespoons", lines(
			ingredient("chilli powder", "1", "tablespoon"),
			ingredient("chilli powder", "2", "tablespoon")),
			[]common.Amount{{Quantity: "3", Unit: "tablespoon"}}},
		// Genuinely mixed, so grams are the honest common denominator.
		{"tablespoon and gram", lines(
			ingredient("chilli powder", "1", "tablespoon"),
			ingredient("chilli powder", "5", "gram")),
			[]common.Amount{{Quantity: "12.5", Unit: "gram"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := CombineIngredients(tc.recipes, testUnits(), catalog)["chilli powder"].Amounts
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("expected %v but got %v", tc.want, got)
			}
		})
	}
}
