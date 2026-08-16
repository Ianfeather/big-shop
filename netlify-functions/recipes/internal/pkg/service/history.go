package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"recipes/internal/pkg/common"
)

// LogShoppingListEvent logs shopping list changes for meal planning
// intelligence - one row per Recipe, written in one statement.
//
// It was one INSERT per Recipe, which is the second of the two loops that made
// POST /shopping-list cost more the more Recipes you put on the list. One
// multi-row INSERT is the shape AddIngredientListItems already uses, so the
// route's cost stops growing with the Recipe count on this path too.
//
// Still all-or-nothing on failure, as it was: a single statement either writes
// every row or none, where the loop could leave a partial history behind. The
// caller treats the whole thing as best-effort either way.
func LogShoppingListEvent(ctx context.Context, caller *common.Caller, eventType string, recipeIDs []int, db *sql.DB) error {
	if len(recipeIDs) == 0 {
		return nil
	}

	accountID, err := caller.AccountID()
	if err != nil {
		return fmt.Errorf("could not get account ID: %w", err)
	}

	placeholders := make([]string, 0, len(recipeIDs))
	args := make([]interface{}, 0, len(recipeIDs)*3)
	for _, recipeID := range recipeIDs {
		placeholders = append(placeholders, "(?, ?, ?)")
		args = append(args, accountID, eventType, recipeID)
	}

	query := fmt.Sprintf(`
		INSERT INTO shopping_list_event
		(account_id, event_type, recipe_id)
		VALUES %s
	`, strings.Join(placeholders, ","))

	if _, err := db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("could not log shopping list event: %w", err)
	}
	return nil
}

// LogShoppingListClearEvent logs when user clears the shopping list
func LogShoppingListClearEvent(ctx context.Context, caller *common.Caller, db *sql.DB) error {
	accountID, err := caller.AccountID()
	if err != nil {
		return fmt.Errorf("could not get account ID: %w", err)
	}

	query := `
		INSERT INTO shopping_list_event
		(account_id, event_type)
		VALUES (?, 'clear_list')
	`
	if _, err := db.ExecContext(ctx, query, accountID); err != nil {
		return fmt.Errorf("could not log clear event: %w", err)
	}
	return nil
}

// GetRecentRecipeUsage returns recently used recipes for meal planning
// Groups by date to avoid counting bulk shopping list updates as multiple uses
func GetRecentRecipeUsage(ctx context.Context, caller *common.Caller, daysBack int, limit int, db *sql.DB) ([]int, error) {
	accountID, err := caller.AccountID()
	if err != nil {
		return nil, fmt.Errorf("could not get account ID: %w", err)
	}

	query := `
		SELECT recipe_id, MAX(created_at) as last_used
		FROM (
			SELECT recipe_id, DATE(created_at) as use_date, MAX(created_at) as created_at
			FROM shopping_list_event
			WHERE account_id = ?
			  AND event_type = 'add_recipe'
			  AND recipe_id IS NOT NULL
			  AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
			GROUP BY recipe_id, DATE(created_at)
		) daily_usage
		GROUP BY recipe_id
		ORDER BY last_used DESC
		LIMIT ?
	`

	rows, err := db.QueryContext(ctx, query, accountID, daysBack, limit)
	if err != nil {
		return nil, fmt.Errorf("could not query recent usage: %w", err)
	}
	defer rows.Close()

	var recentRecipeIDs []int
	for rows.Next() {
		var recipeID int
		var lastUsed string // We don't need the date, just the ID
		if err := rows.Scan(&recipeID, &lastUsed); err != nil {
			return nil, fmt.Errorf("could not scan recipe usage: %w", err)
		}
		recentRecipeIDs = append(recentRecipeIDs, recipeID)
	}

	return recentRecipeIDs, nil
}

// GetFavoriteRecipes returns most frequently used recipes
// Groups by date to avoid counting bulk shopping list updates as multiple uses
func GetFavoriteRecipes(ctx context.Context, caller *common.Caller, limit int, db *sql.DB) ([]int, error) {
	accountID, err := caller.AccountID()
	if err != nil {
		return nil, fmt.Errorf("could not get account ID: %w", err)
	}

	query := `
		SELECT recipe_id, COUNT(*) as usage_count
		FROM (
			SELECT recipe_id, DATE(created_at) as use_date
			FROM shopping_list_event
			WHERE account_id = ?
			  AND event_type = 'add_recipe'
			  AND recipe_id IS NOT NULL
			GROUP BY recipe_id, DATE(created_at)
		) daily_usage
		GROUP BY recipe_id
		HAVING usage_count > 1
		ORDER BY usage_count DESC
		LIMIT ?
	`

	rows, err := db.QueryContext(ctx, query, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("could not query favorites: %w", err)
	}
	defer rows.Close()

	var favoriteRecipeIDs []int
	for rows.Next() {
		var recipeID int
		var usageCount int
		if err := rows.Scan(&recipeID, &usageCount); err != nil {
			return nil, fmt.Errorf("could not scan favorite recipes: %w", err)
		}
		favoriteRecipeIDs = append(favoriteRecipeIDs, recipeID)
	}

	return favoriteRecipeIDs, nil
}
