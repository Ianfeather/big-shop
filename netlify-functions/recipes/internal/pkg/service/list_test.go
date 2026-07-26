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
		want    map[string][]common.Amount
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
			got := CombineIngredients(tc.recipes, testUnits())

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

	got := CombineIngredients(recipes, testUnits())["carrot"]

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
	got := CombineIngredients([]common.Recipe{}, testUnits())
	if len(got) != 0 {
		t.Errorf("expected no ingredients but got %v", got)
	}
}
