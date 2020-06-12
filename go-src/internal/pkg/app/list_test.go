package app

import (
	"recipes/internal/pkg/common"
	"testing"
)

func TestCombineIngredients(t *testing.T) {
	tests := []struct {
		name   string
		a      []common.Ingredient
		expect Ingredient
	}{
		{
			name: "no addition",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "mince",
					Quantity: "1",
					Unit:     "gram",
				},
			},
			expect: Ingredient{
				Unit:     "gram",
				Quantity: 1,
			},
		},
		{
			name: "simple addition",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "mince",
					Quantity: "1",
					Unit:     "gram",
				},
				common.Ingredient{
					Name:     "mince",
					Quantity: "2",
					Unit:     "gram",
				},
			},
			expect: Ingredient{
				Unit:     "gram",
				Quantity: 3,
			},
		},
		{
			name: "addition over threshold",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "mince",
					Quantity: "500",
					Unit:     "gram",
				},
				common.Ingredient{
					Name:     "mince",
					Quantity: "600",
					Unit:     "gram",
				},
			},
			expect: Ingredient{
				Unit:     "kilogram",
				Quantity: 1.1,
			},
		},
		{
			name: "addition over threshold - liquid",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "milk",
					Quantity: "500",
					Unit:     "millilitre",
				},
				common.Ingredient{
					Name:     "milk",
					Quantity: "600",
					Unit:     "millilitre",
				},
			},
			expect: Ingredient{
				Unit:     "litre",
				Quantity: 1.1,
			},
		},
		{
			name: "addition of different units",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "mince",
					Quantity: "500",
					Unit:     "gram",
				},
				common.Ingredient{
					Name:     "mince",
					Quantity: "1",
					Unit:     "kilogram",
				},
				common.Ingredient{
					Name:     "mince",
					Quantity: "200",
					Unit:     "gram",
				},
			},
			expect: Ingredient{
				Unit:     "kilogram",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of different units - liquid",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "milk",
					Quantity: "500",
					Unit:     "millilitre",
				},
				common.Ingredient{
					Name:     "milk",
					Quantity: "1",
					Unit:     "litre",
				},
				common.Ingredient{
					Name:     "milk",
					Quantity: "200",
					Unit:     "millilitre",
				},
			},
			expect: Ingredient{
				Unit:     "litre",
				Quantity: 1.7,
			},
		},
		{
			name: "addition of big units",
			a: []common.Ingredient{
				common.Ingredient{
					Name:     "milk",
					Quantity: "5",
					Unit:     "litre",
				},
				common.Ingredient{
					Name:     "milk",
					Quantity: "1",
					Unit:     "litre",
				},
			},
			expect: Ingredient{
				Unit:     "litre",
				Quantity: 6,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recipes := []common.Recipe{common.Recipe{
				Ingredients: tc.a,
			}}
			result := CombineIngredients(recipes)
			if *result[tc.a[0].Name] != tc.expect {
				t.Errorf("expected %v but got %v", tc.expect, *result[tc.a[0].Name])
			}
		})
	}
}
