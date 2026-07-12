package service

import (
	"database/sql"
)

// Ingredient is a lightweight ingredient type
type Ingredient struct {
	ID                 int      `json:"id"`
	Name               string   `json:"name"`
	PreferredUnitID    *int     `json:"preferredUnitId,omitempty"`
	PreferredUnit      string   `json:"preferredUnit,omitempty"`
	AverageWeightGrams *float64 `json:"averageWeightGrams,omitempty"`
}

// GetAllIngredients returns all recipes in the recipe table
func GetAllIngredients(db *sql.DB) ([]Ingredient, error) {
	query := `
		SELECT
			ingredient.id,
			ingredient.name,
			ingredient.preferred_unit_id,
			unit.name,
			ingredient.average_weight_grams
		FROM ingredient
		LEFT JOIN unit ON unit.id = ingredient.preferred_unit_id
		ORDER BY lower(ingredient.name);
	`
	results, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer results.Close()

	ingredients := make([]Ingredient, 0)

	for results.Next() {
		var preferredUnitID sql.NullInt64
		var preferredUnitName sql.NullString
		var averageWeightGrams sql.NullFloat64

		r := Ingredient{}
		err = results.Scan(&r.ID, &r.Name, &preferredUnitID, &preferredUnitName, &averageWeightGrams)
		if err != nil {
			return nil, err
		}

		if preferredUnitID.Valid {
			id := int(preferredUnitID.Int64)
			r.PreferredUnitID = &id
		}
		if preferredUnitName.Valid {
			r.PreferredUnit = preferredUnitName.String
		}
		if averageWeightGrams.Valid {
			weight := averageWeightGrams.Float64
			r.AverageWeightGrams = &weight
		}

		ingredients = append(ingredients, r)
	}
	return ingredients, nil
}

// IngredientClassificationUpdate is the payload for manually editing an
// ingredient's preferred unit / average weight from the ingredient audit
// page (pages/ingredients/audit.js). A nil field clears that column.
type IngredientClassificationUpdate struct {
	ID                 int      `json:"id"`
	PreferredUnitID    *int     `json:"preferredUnitId"`
	AverageWeightGrams *float64 `json:"averageWeightGrams"`
}

// UpdateIngredientClassification sets an ingredient's preferred_unit_id and
// average_weight_grams directly. Distinct from ApplyIngredientClassification,
// which stores the LLM's proposal for a newly created ingredient - this is
// the manual override/correction path.
func UpdateIngredientClassification(update IngredientClassificationUpdate, db *sql.DB) error {
	_, err := db.Exec(
		"UPDATE ingredient SET preferred_unit_id = ?, average_weight_grams = ? WHERE id = ?",
		update.PreferredUnitID, update.AverageWeightGrams, update.ID,
	)
	return err
}
