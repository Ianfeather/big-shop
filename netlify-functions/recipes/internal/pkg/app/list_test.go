package app

import (
	"recipes/internal/pkg/common"
	"testing"
)

// unit fixtures matching migrations/016_unit_normalisation.sql
var (
	gramUnit       = func() (string, float64) { return string(unitClassWeight), 1 }
	kilogramUnit   = func() (string, float64) { return string(unitClassWeight), 1000 }
	millilitreUnit = func() (string, float64) { return string(unitClassVolume), 1 }
	litreUnit      = func() (string, float64) { return string(unitClassVolume), 1000 }
)

func ingredient(name, quantity, unit string, unitFixture func() (string, float64)) common.Ingredient {
	unitType, baseFactor := unitFixture()
	return common.Ingredient{
		Name:       name,
		Quantity:   quantity,
		Unit:       unit,
		UnitType:   unitType,
		BaseFactor: baseFactor,
	}
}

func countIngredient(name, quantity, unit string) common.Ingredient {
	return common.Ingredient{
		Name:       name,
		Quantity:   quantity,
		Unit:       unit,
		UnitType:   string(unitClassCount),
		BaseFactor: 1,
	}
}

func TestCombineIngredients(t *testing.T) {
	tests := []struct {
		name   string
		a      []common.Ingredient
		expect common.ListIngredient
	}{
		{
			name: "no addition",
			a: []common.Ingredient{
				ingredient("mince", "1", "gram", gramUnit),
			},
			expect: common.ListIngredient{
				Unit:     "gram",
				Quantity: 1,
			},
		},
		{
			name: "simple addition",
			a: []common.Ingredient{
				ingredient("mince", "1", "gram", gramUnit),
				ingredient("mince", "2", "gram", gramUnit),
			},
			expect: common.ListIngredient{
				Unit:     "gram",
				Quantity: 3,
			},
		},
		{
			name: "addition over threshold",
			a: []common.Ingredient{
				ingredient("mince", "500", "gram", gramUnit),
				ingredient("mince", "600", "gram", gramUnit),
			},
			expect: common.ListIngredient{
				Unit:     "kilogram",
				Quantity: 1.1,
			},
		},
		{
			name: "addition over threshold - liquid",
			a: []common.Ingredient{
				ingredient("milk", "500", "millilitre", millilitreUnit),
				ingredient("milk", "600", "millilitre", millilitreUnit),
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 1.1,
			},
		},
		{
			name: "addition of different units",
			a: []common.Ingredient{
				ingredient("mince", "500", "gram", gramUnit),
				ingredient("mince", "1", "kilogram", kilogramUnit),
				ingredient("mince", "200", "gram", gramUnit),
			},
			expect: common.ListIngredient{
				Unit:     "kilogram",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of different units - liquid",
			a: []common.Ingredient{
				ingredient("milk", "500", "millilitre", millilitreUnit),
				ingredient("milk", "1", "litre", litreUnit),
				ingredient("milk", "200", "millilitre", millilitreUnit),
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of big units",
			a: []common.Ingredient{
				ingredient("milk", "5", "litre", litreUnit),
				ingredient("milk", "1", "litre", litreUnit),
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 6,
			},
		},
		{
			name: "mixed number and fraction quantities",
			a: []common.Ingredient{
				ingredient("mince", "1 1/2", "gram", gramUnit),
				ingredient("mince", "1/2", "gram", gramUnit),
			},
			expect: common.ListIngredient{
				Unit:     "gram",
				Quantity: 2,
			},
		},
		{
			name: "count only, no average weight - passthrough",
			a: []common.Ingredient{
				countIngredient("tomato", "2", "whole"),
				countIngredient("tomato", "1", "whole"),
			},
			expect: common.ListIngredient{
				Unit:     "whole",
				Quantity: 3,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recipes := []common.Recipe{{
				Ingredients: tc.a,
			}}
			result := CombineIngredients(recipes)
			got, ok := result[tc.a[0].Name]
			if !ok {
				t.Fatalf("expected a result for %q, got none (result: %v)", tc.a[0].Name, result)
			}
			if *got != tc.expect {
				t.Errorf("expected %v but got %v", tc.expect, *got)
			}
		})
	}
}

// TestCombineIngredients_CountAndWeight covers spec/unit-normalisation.md's
// "2 tomatoes" + "150g tomatoes" example: combining a count-typed quantity
// with a weight-typed one via the ingredient's average item weight, in
// either direction depending on the ingredient's preferred unit.
func TestCombineIngredients_CountAndWeight(t *testing.T) {
	withAverageWeight := func(i common.Ingredient, grams float64) common.Ingredient {
		i.AverageWeightGrams = grams
		return i
	}
	withPreferredUnit := func(i common.Ingredient, unit string, unitType unitClass, baseFactor float64) common.Ingredient {
		i.PreferredUnit = unit
		i.PreferredUnitType = string(unitType)
		i.PreferredUnitBaseFactor = baseFactor
		return i
	}

	t.Run("combines into weight when no preferred unit is set", func(t *testing.T) {
		avgWeight := 150.0
		ingredients := []common.Ingredient{
			withAverageWeight(countIngredient("tomato", "2", "whole"), avgWeight),
			withAverageWeight(ingredient("tomato", "200", "gram", gramUnit), avgWeight),
		}
		result := CombineIngredients([]common.Recipe{{Ingredients: ingredients}})
		got := result["tomato"]
		if got == nil {
			t.Fatalf("expected a combined tomato line, got none (result: %v)", result)
		}
		want := common.ListIngredient{Unit: "gram", Quantity: 500} // 200g + (2 * 150g)
		if *got != want {
			t.Errorf("expected %v but got %v", want, *got)
		}
	})

	t.Run("combines into count and rounds up when preferred unit is count-typed", func(t *testing.T) {
		avgWeight := 150.0
		ingredients := []common.Ingredient{
			withPreferredUnit(withAverageWeight(countIngredient("tomato", "2", "whole"), avgWeight), "whole", unitClassCount, 1),
			withPreferredUnit(withAverageWeight(ingredient("tomato", "200", "gram", gramUnit), avgWeight), "whole", unitClassCount, 1),
		}
		result := CombineIngredients([]common.Recipe{{Ingredients: ingredients}})
		got := result["tomato"]
		if got == nil {
			t.Fatalf("expected a combined tomato line, got none (result: %v)", result)
		}
		// 2 + (200/150) = 3.33.. -> rounds up to the nearest half, never down
		want := common.ListIngredient{Unit: "whole", Quantity: 3.5}
		if *got != want {
			t.Errorf("expected %v but got %v", want, *got)
		}
	})
}

// TestCombineIngredients_WeightVolumeMismatch covers the case
// spec/unit-normalisation.md explicitly leaves unmerged: a weight quantity
// and a volume quantity for the same ingredient can't be combined without a
// density figure, so both should appear rather than one silently winning.
func TestCombineIngredients_WeightVolumeMismatch(t *testing.T) {
	ingredients := []common.Ingredient{
		ingredient("flour", "50", "gram", gramUnit),
		{
			Name:       "flour",
			Quantity:   "2",
			Unit:       "tablespoon",
			UnitType:   string(unitClassVolume),
			BaseFactor: 15,
		},
	}
	result := CombineIngredients([]common.Recipe{{Ingredients: ingredients}})

	weightLine, ok := result["flour"]
	if !ok {
		t.Fatalf("expected a primary weight line for flour, result: %v", result)
	}
	if want := (common.ListIngredient{Unit: "gram", Quantity: 50}); *weightLine != want {
		t.Errorf("expected %v but got %v", want, *weightLine)
	}

	volumeLine, ok := result["flour (millilitre)"]
	if !ok {
		t.Fatalf("expected a secondary volume line for flour, result: %v", result)
	}
	if want := (common.ListIngredient{Unit: "millilitre", Quantity: 30}); *volumeLine != want {
		t.Errorf("expected %v but got %v", want, *volumeLine)
	}
}
