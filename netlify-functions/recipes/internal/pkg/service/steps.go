package service

import (
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
)

// GetStepsByRecipeID fetches all steps for a recipe ordered by step_number
func GetStepsByRecipeID(recipeID int, db *sql.DB) ([]common.Step, error) {
	query := `
		SELECT id, recipe_id, step_number, instruction, duration_minutes, step_type
		FROM step
		WHERE recipe_id = ?
		ORDER BY step_number ASC;
	`
	results, err := db.Query(query, recipeID)
	if err != nil {
		return nil, err
	}
	defer results.Close()

	steps := make([]common.Step, 0)
	for results.Next() {
		var s common.Step
		var duration sql.NullInt64
		err = results.Scan(&s.ID, &s.RecipeID, &s.StepNumber, &s.Instruction, &duration, &s.StepType)
		if err != nil {
			return nil, err
		}
		if duration.Valid {
			d := int(duration.Int64)
			s.DurationMinutes = &d
		}
		steps = append(steps, s)
	}
	return steps, nil
}

// SaveSteps replaces all steps for a recipe
func SaveSteps(recipeID int, steps []common.Step, db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM step WHERE recipe_id = ?", recipeID); err != nil {
		tx.Rollback()
		return err
	}

	for i, s := range steps {
		stepNumber := i + 1
		_, err := tx.Exec(
			`INSERT INTO step (recipe_id, step_number, instruction, duration_minutes, step_type)
			 VALUES (?, ?, ?, ?, ?)`,
			recipeID, stepNumber, s.Instruction, s.DurationMinutes, s.StepType,
		)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("could not insert step %d: %w", stepNumber, err)
		}
	}

	return tx.Commit()
}
