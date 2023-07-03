package app

import (
	"recipes/internal/pkg/common"
	"testing"
)

func TestCombineIngredients(t *testing.T) {
	tests := []struct {
		name   string
		a      []common.Ingredient
		expect common.ListIngredient
	}{
		{
			name: "no addition",
			a: []common.Ingredient{
				{
					Name:     "mince",
					Quantity: "1",
					Unit:     "gram",
				},
			},
			expect: common.ListIngredient{
				Unit:     "gram",
				Quantity: 1,
			},
		},
		{
			name: "simple addition",
			a: []common.Ingredient{
				{
					Name:     "mince",
					Quantity: "1",
					Unit:     "gram",
				},
				{
					Name:     "mince",
					Quantity: "2",
					Unit:     "gram",
				},
			},
			expect: common.ListIngredient{
				Unit:     "gram",
				Quantity: 3,
			},
		},
		{
			name: "addition over threshold",
			a: []common.Ingredient{
				{
					Name:     "mince",
					Quantity: "500",
					Unit:     "gram",
				},
				{
					Name:     "mince",
					Quantity: "600",
					Unit:     "gram",
				},
			},
			expect: common.ListIngredient{
				Unit:     "kilogram",
				Quantity: 1.1,
			},
		},
		{
			name: "addition over threshold - liquid",
			a: []common.Ingredient{
				{
					Name:     "milk",
					Quantity: "500",
					Unit:     "millilitre",
				},
				{
					Name:     "milk",
					Quantity: "600",
					Unit:     "millilitre",
				},
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 1.1,
			},
		},
		{
			name: "addition of different units",
			a: []common.Ingredient{
				{
					Name:     "mince",
					Quantity: "500",
					Unit:     "gram",
				},
				{
					Name:     "mince",
					Quantity: "1",
					Unit:     "kilogram",
				},
				{
					Name:     "mince",
					Quantity: "200",
					Unit:     "gram",
				},
			},
			expect: common.ListIngredient{
				Unit:     "kilogram",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of different units - liquid",
			a: []common.Ingredient{
				{
					Name:     "milk",
					Quantity: "500",
					Unit:     "millilitre",
				},
				{
					Name:     "milk",
					Quantity: "1",
					Unit:     "litre",
				},
				{
					Name:     "milk",
					Quantity: "200",
					Unit:     "millilitre",
				},
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of big units",
			a: []common.Ingredient{
				{
					Name:     "milk",
					Quantity: "5",
					Unit:     "litre",
				},
				{
					Name:     "milk",
					Quantity: "1",
					Unit:     "litre",
				},
			},
			expect: common.ListIngredient{
				Unit:     "litre",
				Quantity: 6,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recipes := []common.Recipe{{
				Ingredients: tc.a,
			}}
			result := CombineIngredients(recipes)
			if *result[tc.a[0].Name] != tc.expect {
				t.Errorf("expected %v but got %v", tc.expect, *result[tc.a[0].Name])
			}
		})
	}
}
