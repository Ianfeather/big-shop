package service

import (
	"recipes/internal/pkg/common"
	"reflect"
	"testing"
)

func TestApplyDisplayUnits(t *testing.T) {
	units := testUnits()
	units["pinch"] = UnitInfo{Kind: KindRelative, DefaultSize: 0.5}

	tests := []struct {
		name        string
		items       map[string]*common.ListIngredient
		ingredients IngredientCatalog
		want        map[string][]common.Amount
	}{
		{
			// The case this whole phase exists for: you can't buy 800g of
			// tinned tomatoes, you buy tins.
			name:  "a weight total is shown in tins, with the weight kept alongside",
			items: items("chopped tomatoes", amount("800", "gram")),
			ingredients: IngredientCatalog{
				"chopped tomatoes": {BaseUnit: "gram", DisplayUnit: "tin", HasDisplayUnit: true,
					UnitSizes: map[string]float64{"tin": 400}},
			},
			want: map[string][]common.Amount{
				"chopped tomatoes": {{Quantity: "2", Unit: "tin", BaseQuantity: "800", BaseUnit: "gram"}},
			},
		},
		{
			// Rounds up to a whole: 1.75 tins isn't something you can pick up.
			name:  "a relative display unit rounds up to a whole",
			items: items("chopped tomatoes", amount("700", "gram")),
			ingredients: IngredientCatalog{
				"chopped tomatoes": {BaseUnit: "gram", DisplayUnit: "tin", HasDisplayUnit: true,
					UnitSizes: map[string]float64{"tin": 400}},
			},
			want: map[string][]common.Amount{
				"chopped tomatoes": {{Quantity: "2", Unit: "tin", BaseQuantity: "700", BaseUnit: "gram"}},
			},
		},
		{
			// Never rounds down to nothing - you still have to buy one.
			name:  "less than one still rounds up to one",
			items: items("chopped tomatoes", amount("50", "gram")),
			ingredients: IngredientCatalog{
				"chopped tomatoes": {BaseUnit: "gram", DisplayUnit: "tin", HasDisplayUnit: true,
					UnitSizes: map[string]float64{"tin": 400}},
			},
			want: map[string][]common.Amount{
				"chopped tomatoes": {{Quantity: "1", Unit: "tin", BaseQuantity: "50", BaseUnit: "gram"}},
			},
		},
		{
			// The count case, across the kilogram scale-up.
			name:  "a kilogram total is shown as a count",
			items: items("onion", amount("1.65", "kilogram")),
			ingredients: IngredientCatalog{
				"onion": {BaseUnit: "gram", DisplayUnit: "", HasDisplayUnit: true, UnitSizes: map[string]float64{"": 150}},
			},
			want: map[string][]common.Amount{
				"onion": {{Quantity: "11", Unit: "", BaseQuantity: "1.65", BaseUnit: "kilogram"}},
			},
		},
		{
			// An Absolute Display Unit keeps its natural precision rather than
			// being rounded to a whole - nobody wants weights to the half kilo.
			// No bracket either: millilitre to litre is exact, so there is no
			// estimate to expose.
			name:  "an absolute display unit is not rounded up",
			items: items("milk", amount("1500", "millilitre")),
			ingredients: IngredientCatalog{
				"milk": {BaseUnit: "millilitre", DisplayUnit: "litre", HasDisplayUnit: true},
			},
			want: map[string][]common.Amount{
				"milk": {{Quantity: "1.5", Unit: "litre"}},
			},
		},
		{
			// No brackets when there was no conversion to show.
			name:  "an amount already in the display unit is left alone",
			items: items("chopped tomatoes", amount("2", "tin")),
			ingredients: IngredientCatalog{
				"chopped tomatoes": {BaseUnit: "gram", DisplayUnit: "tin", HasDisplayUnit: true,
					UnitSizes: map[string]float64{"tin": 400}},
			},
			want: map[string][]common.Amount{
				"chopped tomatoes": {{Quantity: "2", Unit: "tin"}},
			},
		},
		{
			name:        "an ingredient with no display unit is untouched",
			items:       items("flour", amount("500", "gram")),
			ingredients: IngredientCatalog{"flour": {BaseUnit: "gram"}},
			want: map[string][]common.Amount{
				"flour": {{Quantity: "500", Unit: "gram"}},
			},
		},
		{
			// Only the convertible Amounts move; an unconvertible one stays put
			// rather than being forced into a unit it has no relation to.
			name: "only convertible amounts are converted",
			items: items("parsley",
				amount("60", "gram"),
				amount("1", "packet"),
				amount("a handful", "gram")),
			ingredients: IngredientCatalog{
				"parsley": {BaseUnit: "gram", DisplayUnit: "", HasDisplayUnit: true, UnitSizes: map[string]float64{"": 30}},
			},
			want: map[string][]common.Amount{
				"parsley": {
					{Quantity: "2", Unit: "", BaseQuantity: "60", BaseUnit: "gram"},
					{Quantity: "1", Unit: "packet"},
					{Quantity: "a handful", Unit: "gram"},
				},
			},
		},
		{
			// A Display Unit nothing can be converted into is inert rather than
			// an error - it just doesn't apply.
			name:  "a display unit with no Unit Size does nothing",
			items: items("mystery", amount("100", "gram")),
			ingredients: IngredientCatalog{
				"mystery": {BaseUnit: "gram", DisplayUnit: "packet", HasDisplayUnit: true},
			},
			want: map[string][]common.Amount{
				"mystery": {{Quantity: "100", Unit: "gram"}},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ApplyDisplayUnits(tc.items, units, tc.ingredients)
			for name, want := range tc.want {
				if got := tc.items[name].Amounts; !reflect.DeepEqual(got, want) {
					t.Errorf("%q: expected %v but got %v", name, want, got)
				}
			}
		})
	}
}

func amount(quantity, unit string) common.Amount {
	return common.Amount{Quantity: quantity, Unit: unit}
}

func items(name string, amounts ...common.Amount) map[string]*common.ListIngredient {
	return map[string]*common.ListIngredient{name: {Amounts: amounts}}
}

// The bracket is there to expose an estimate. An exact conversion between two
// Absolute Units of the same dimension involves none, so it would be noise.
func TestApplyDisplayUnitsOmitsTheBracketForAnExactConversion(t *testing.T) {
	units := testUnits()
	catalog := IngredientCatalog{
		"ground coriander": {BaseUnit: "gram", DisplayUnit: "teaspoon", HasDisplayUnit: true,
			UnitSizes: map[string]float64{"millilitre": 0.5}},
	}

	t.Run("tablespoon to teaspoon is exact, so no bracket", func(t *testing.T) {
		it := items("ground coriander", amount("2", "tablespoon"))
		ApplyDisplayUnits(it, units, catalog)
		want := []common.Amount{{Quantity: "6", Unit: "teaspoon"}}
		if got := it["ground coriander"].Amounts; !reflect.DeepEqual(got, want) {
			t.Errorf("expected %v but got %v", want, got)
		}
	})

	t.Run("gram to teaspoon relies on a density, so the bracket stays", func(t *testing.T) {
		it := items("ground coriander", amount("12.5", "gram"))
		ApplyDisplayUnits(it, units, catalog)
		want := []common.Amount{{Quantity: "5", Unit: "teaspoon", BaseQuantity: "12.5", BaseUnit: "gram"}}
		if got := it["ground coriander"].Amounts; !reflect.DeepEqual(got, want) {
			t.Errorf("expected %v but got %v", want, got)
		}
	})
}
