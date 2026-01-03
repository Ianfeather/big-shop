package service

import (
	"database/sql"
	"fmt"
)

// LogShoppingListEvent logs shopping list changes for meal planning intelligence
func LogShoppingListEvent(userID string, eventType string, recipeIDs []int, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return fmt.Errorf("could not get account ID: %v", err)
	}

	// Log each recipe as a separate event
	for _, recipeID := range recipeIDs {
		query := `
			INSERT INTO shopping_list_event
			(account_id, event_type, recipe_id)
			VALUES (?, ?, ?)
		`
		if _, err := db.Exec(query, accountID, eventType, recipeID); err != nil {
			return fmt.Errorf("could not log shopping list event: %v", err)
		}
	}
	return nil
}

// LogShoppingListClearEvent logs when user clears the shopping list
func LogShoppingListClearEvent(userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return fmt.Errorf("could not get account ID: %v", err)
	}

	query := `
		INSERT INTO shopping_list_event
		(account_id, event_type)
		VALUES (?, 'clear_list')
	`
	if _, err := db.Exec(query, accountID); err != nil {
		return fmt.Errorf("could not log clear event: %v", err)
	}
	return nil
}

// GetRecentRecipeUsage returns recently used recipes for meal planning
// Groups by date to avoid counting bulk shopping list updates as multiple uses
func GetRecentRecipeUsage(userID string, daysBack int, limit int, db *sql.DB) ([]int, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, fmt.Errorf("could not get account ID: %v", err)
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

	rows, err := db.Query(query, accountID, daysBack, limit)
	if err != nil {
		return nil, fmt.Errorf("could not query recent usage: %v", err)
	}
	defer rows.Close()

	var recentRecipeIDs []int
	for rows.Next() {
		var recipeID int
		var lastUsed string // We don't need the date, just the ID
		if err := rows.Scan(&recipeID, &lastUsed); err != nil {
			return nil, fmt.Errorf("could not scan recipe usage: %v", err)
		}
		recentRecipeIDs = append(recentRecipeIDs, recipeID)
	}

	return recentRecipeIDs, nil
}

// GetFavoriteRecipes returns most frequently used recipes
// Groups by date to avoid counting bulk shopping list updates as multiple uses
func GetFavoriteRecipes(userID string, limit int, db *sql.DB) ([]int, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, fmt.Errorf("could not get account ID: %v", err)
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

	rows, err := db.Query(query, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("could not query favorites: %v", err)
	}
	defer rows.Close()

	var favoriteRecipeIDs []int
	for rows.Next() {
		var recipeID int
		var usageCount int
		if err := rows.Scan(&recipeID, &usageCount); err != nil {
			return nil, fmt.Errorf("could not scan favorite recipes: %v", err)
		}
		favoriteRecipeIDs = append(favoriteRecipeIDs, recipeID)
	}

	return favoriteRecipeIDs, nil
}

// GetRecipeIDsFromStrings converts string slice to int slice for logging
func GetRecipeIDsFromStrings(recipeIDs []string) ([]int, error) {
	var intIDs []int
	for _, idStr := range recipeIDs {
		if idStr == "" {
			continue
		}
		// Parse string to int, handling potential errors
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil {
			return nil, fmt.Errorf("invalid recipe ID: %s", idStr)
		}
		intIDs = append(intIDs, id)
	}
	return intIDs, nil
}
