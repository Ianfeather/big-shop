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

// The reason this exists: a Shopping List is read by someone in a shop, and
// "4.444444 teaspoon" is not an instruction anyone can follow (follow-ups.md #39).
func TestRoundAmountsForShopping(t *testing.T) {
	units := testUnits()

	tests := []struct {
		name string
		in   common.Amount
		want common.Amount
	}{
		{
			name: "the case this exists for: a converted spoon total lands on a quarter",
			in:   common.Amount{Quantity: "4.444444", Unit: "teaspoon", BaseQuantity: "10", BaseUnit: "gram"},
			want: common.Amount{Quantity: "4.5", Unit: "teaspoon", BaseQuantity: "10", BaseUnit: "gram"},
		},
		{
			// A quarter is a real measuring spoon; 0.3 of one isn't. Up rather
			// than to-nearest, so a spice never comes up short.
			name: "a small spoon amount rounds up to a quarter rather than a decimal",
			in:   common.Amount{Quantity: "0.2222", Unit: "teaspoon"},
			want: common.Amount{Quantity: "0.25", Unit: "teaspoon"},
		},
		{
			name: "a spoon amount already on a quarter is left where it is",
			in:   common.Amount{Quantity: "1.5", Unit: "tablespoon"},
			want: common.Amount{Quantity: "1.5", Unit: "tablespoon"},
		},
		{
			// You can't buy 1.75 tins. Same rule the Display Unit work already
			// applied - it just now reaches Amounts that were never converted.
			name: "a relative unit rounds up to a whole",
			in:   common.Amount{Quantity: "1.75", Unit: "tin"},
			want: common.Amount{Quantity: "2", Unit: "tin"},
		},
		{
			name: "a bare count rounds up to a whole",
			in:   common.Amount{Quantity: "2.4", Unit: ""},
			want: common.Amount{Quantity: "3", Unit: ""},
		},
		{
			name: "a weight of ten or more loses its decimals",
			in:   common.Amount{Quantity: "63.333333", Unit: "gram"},
			want: common.Amount{Quantity: "63", Unit: "gram"},
		},
		{
			name: "a weight between one and ten keeps one decimal",
			in:   common.Amount{Quantity: "1.04", Unit: "kilogram"},
			want: common.Amount{Quantity: "1", Unit: "kilogram"},
		},
		{
			// The bug the other direction: rounding this to a whole would say
			// "buy 0 kilogram of beef".
			name: "a weight under one keeps enough precision not to vanish",
			in:   common.Amount{Quantity: "0.44444", Unit: "kilogram"},
			want: common.Amount{Quantity: "0.44", Unit: "kilogram"},
		},
		{
			name: "a very small weight keeps two significant figures",
			in:   common.Amount{Quantity: "0.041666", Unit: "kilogram"},
			want: common.Amount{Quantity: "0.042", Unit: "kilogram"},
		},
		{
			// Not a spoon: a quarter of a millilitre is not a thing anyone
			// measures, so this reads as a volume.
			name: "the volume base unit is not treated as a measuring spoon",
			in:   common.Amount{Quantity: "12.4", Unit: "millilitre"},
			want: common.Amount{Quantity: "12", Unit: "millilitre"},
		},
		{
			name: "the bracketed working is rounded in its own unit",
			in:   common.Amount{Quantity: "3", Unit: "tin", BaseQuantity: "1050.0004", BaseUnit: "gram"},
			want: common.Amount{Quantity: "3", Unit: "tin", BaseQuantity: "1050", BaseUnit: "gram"},
		},
		{
			// ParseQuantity's contract: an unreadable quantity reaches the
			// shopper verbatim rather than being dropped or invented.
			name: "an unreadable quantity is left exactly as it is",
			in:   common.Amount{Quantity: "a handful", Unit: "gram"},
			want: common.Amount{Quantity: "a handful", Unit: "gram"},
		},
		{
			// Rounding this up would invent an item to buy.
			name: "zero is not rounded up to one",
			in:   common.Amount{Quantity: "0", Unit: "tin"},
			want: common.Amount{Quantity: "0", Unit: "tin"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			it := items("thing", tc.in)
			RoundAmountsForShopping(it, units)
			if got := it["thing"].Amounts[0]; got != tc.want {
				t.Errorf("expected %v but got %v", tc.want, got)
			}
		})
	}
}

// Rounding runs once, at the end of the read - so running it again must not
// walk a quantity further away from the number it was summed from.
func TestRoundAmountsForShoppingIsIdempotent(t *testing.T) {
	units := testUnits()
	it := items("thing",
		amount("4.444444", "teaspoon"),
		amount("1.75", "tin"),
		amount("0.44444", "kilogram"),
		amount("63.333333", "gram"))

	RoundAmountsForShopping(it, units)
	once := append([]common.Amount(nil), it["thing"].Amounts...)
	RoundAmountsForShopping(it, units)

	if got := it["thing"].Amounts; !reflect.DeepEqual(got, once) {
		t.Errorf("expected %v but got %v", once, got)
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
