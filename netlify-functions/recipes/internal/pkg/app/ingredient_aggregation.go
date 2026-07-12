package app

import (
	"fmt"
	"math"
	"recipes/internal/pkg/common"
)

type unitClass string

const (
	unitClassWeight unitClass = "weight"
	unitClassVolume unitClass = "volume"
	unitClassCount  unitClass = "count"

	gramsPerKilogram    = 1000.0
	millilitresPerLitre = 1000.0
)

// aggregatedIngredient accumulates every line for one ingredient name across
// the selected recipes, split by unit class, before a final display unit is
// chosen.
type aggregatedIngredient struct {
	department string
	recipeID   int

	grams       float64
	hasWeight   bool
	millilitres float64
	hasVolume   bool
	count       float64
	hasCount    bool
	countUnit   string // display name for the count bucket, from the first count-typed line seen

	averageWeightGrams float64 // 0 = unknown

	preferredUnit           string
	preferredUnitType       unitClass
	preferredUnitBaseFactor float64
}

// combinedComponent is one unit-class's total within an aggregatedIngredient,
// once quantities of the same class have been summed to a common base unit.
type combinedComponent struct {
	class unitClass
	total float64
}

// CombineIngredients merges ingredient quantities across recipes into the
// values/units to show on a shopping list.
//
// It sums same-unit-class quantities directly (weight -> grams, volume ->
// millilitres, count -> raw count) using unit.base_factor, then - if the
// ingredient's average weight is known - folds count and weight into each
// other so e.g. "3 tomatoes" and "150g tomatoes" combine into one line. A
// weight and a volume figure for the same ingredient can't be combined
// without a density figure this doesn't have (see spec/density-conversion.md),
// so they're kept as separate list lines rather than silently mixed.
func CombineIngredients(r []common.Recipe) map[string]*common.ListIngredient {
	aggregates := make(map[string]*aggregatedIngredient)

	for _, recipe := range r {
		for _, ingredient := range recipe.Ingredients {
			q, err := common.ParseQuantity(ingredient.Quantity)
			if err != nil {
				continue
			}

			agg, exists := aggregates[ingredient.Name]
			if !exists {
				agg = &aggregatedIngredient{
					department:              ingredient.Department,
					recipeID:                recipe.ID,
					averageWeightGrams:      ingredient.AverageWeightGrams,
					preferredUnit:           ingredient.PreferredUnit,
					preferredUnitType:       unitClass(ingredient.PreferredUnitType),
					preferredUnitBaseFactor: ingredient.PreferredUnitBaseFactor,
				}
				aggregates[ingredient.Name] = agg
			}

			switch unitClass(ingredient.UnitType) {
			case unitClassWeight:
				agg.grams += q * ingredient.BaseFactor
				agg.hasWeight = true
			case unitClassVolume:
				agg.millilitres += q * ingredient.BaseFactor
				agg.hasVolume = true
			default:
				agg.count += q * ingredient.BaseFactor
				agg.hasCount = true
				if agg.countUnit == "" {
					agg.countUnit = ingredient.Unit
				}
			}
		}
	}

	result := make(map[string]*common.ListIngredient)
	for name, agg := range aggregates {
		for key, li := range renderIngredient(agg) {
			if key == "" {
				key = name
			} else {
				key = fmt.Sprintf("%s (%s)", name, key)
			}
			result[key] = li
		}
	}

	return result
}

// renderIngredient decides the final display unit(s) for one ingredient's
// aggregated totals, returning the primary line keyed by "" and any
// unmergeable leftover lines keyed by their rendered unit name.
func renderIngredient(agg *aggregatedIngredient) map[string]*common.ListIngredient {
	target := resolveTargetClass(agg)
	foldCountAndWeight(agg, target)

	components := make([]combinedComponent, 0, 3)
	if agg.hasWeight {
		components = append(components, combinedComponent{unitClassWeight, agg.grams})
	}
	if agg.hasVolume {
		components = append(components, combinedComponent{unitClassVolume, agg.millilitres})
	}
	if agg.hasCount {
		components = append(components, combinedComponent{unitClassCount, agg.count})
	}
	if len(components) == 0 {
		return nil
	}

	primary := 0
	for i, c := range components {
		if c.class == target {
			primary = i
			break
		}
	}

	lines := make(map[string]*common.ListIngredient, len(components))
	for i, c := range components {
		li := renderComponent(c.class, c.total, agg)
		if i == primary {
			lines[""] = li
		} else {
			lines[li.Unit] = li
		}
	}
	return lines
}

// resolveTargetClass picks the unit class we'd like the ingredient to end up
// displayed in: the ingredient's preferred unit if one is set, else whichever
// class is present, preferring weight, then volume, then count.
func resolveTargetClass(agg *aggregatedIngredient) unitClass {
	if agg.preferredUnitType != "" {
		return agg.preferredUnitType
	}
	switch {
	case agg.hasWeight:
		return unitClassWeight
	case agg.hasVolume:
		return unitClassVolume
	default:
		return unitClassCount
	}
}

// foldCountAndWeight uses the ingredient's average item weight (if known) to
// merge its count bucket into its weight bucket, or vice versa, whichever
// direction the target display class needs. It never touches the volume
// bucket - there's no data here to convert weight/volume into count or
// each other (see spec/density-conversion.md).
func foldCountAndWeight(agg *aggregatedIngredient, target unitClass) {
	if agg.averageWeightGrams <= 0 {
		return
	}
	if target == unitClassCount && agg.hasWeight {
		agg.count += agg.grams / agg.averageWeightGrams
		agg.hasCount = true
		agg.grams = 0
		agg.hasWeight = false
	} else if target != unitClassCount && agg.hasCount {
		agg.grams += agg.count * agg.averageWeightGrams
		agg.hasWeight = true
		agg.count = 0
		agg.hasCount = false
	}
}

func renderComponent(class unitClass, total float64, agg *aggregatedIngredient) *common.ListIngredient {
	li := &common.ListIngredient{
		Department: agg.department,
		RecipeID:   agg.recipeID,
	}

	usesPreferredUnit := agg.preferredUnitType == class && agg.preferredUnit != "" && agg.preferredUnitBaseFactor > 0

	switch class {
	case unitClassWeight:
		if usesPreferredUnit {
			li.Unit = agg.preferredUnit
			li.Quantity = total / agg.preferredUnitBaseFactor
			return li
		}
		if total >= gramsPerKilogram {
			li.Unit = "kilogram"
			li.Quantity = total / gramsPerKilogram
		} else {
			li.Unit = "gram"
			li.Quantity = total
		}
	case unitClassVolume:
		if usesPreferredUnit {
			li.Unit = agg.preferredUnit
			li.Quantity = total / agg.preferredUnitBaseFactor
			return li
		}
		if total >= millilitresPerLitre {
			li.Unit = "litre"
			li.Quantity = total / millilitresPerLitre
		} else {
			li.Unit = "millilitre"
			li.Quantity = total
		}
	default: // unitClassCount
		unit := agg.countUnit
		displayTotal := total
		if usesPreferredUnit {
			unit = agg.preferredUnit
			displayTotal = total / agg.preferredUnitBaseFactor
		}
		if unit == "" {
			unit = "whole"
		}
		li.Unit = unit
		// Never show a fractional item count - round up so the shopper
		// never comes up short (spec/unit-normalisation.md).
		li.Quantity = math.Ceil(displayTotal*2) / 2
	}

	return li
}
