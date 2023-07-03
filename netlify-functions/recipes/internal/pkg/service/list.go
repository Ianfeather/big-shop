package service

import (
	"fmt"
	"recipes/internal/pkg/common"

	"database/sql"
)

// ListItem is used to interface with the DB
type ListItem struct {
	Name       string
	Unit       string
	Quantity   float64
	Department string
	IsBought   bool
}

// GetShoppingList returns the full shopping list for a user
func GetShoppingList(userID string, db *sql.DB) (*common.ShoppingList, error) {
	recipes, err := GetRecipesFromList(userID, db)
	if err != nil {
		fmt.Println("could not get recipes from list")
		return nil, err
	}

	ingredients, err := GetIngredientListItems(userID, db)
	if err != nil {
		fmt.Println("could not get ingredients from list")
		return nil, err
	}

	extras, err := GetExtraListItems(userID, db)
	if err != nil {
		fmt.Println("could not get extra list items")
		return nil, err
	}

	list := &common.ShoppingList{
		Recipes:     recipes,
		Ingredients: ingredients,
		Extras:      extras,
	}

	return list, nil
}

// RemoveAllListItems removes all list items for a user
func RemoveAllListItems(userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	if _, err := db.Exec("DELETE FROM list WHERE account_id = ?;", accountID); err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// RemoveIngredientListItems removes all ingredient list items
func RemoveIngredientListItems(userID string, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	if _, err := db.Exec("DELETE FROM list WHERE account_id = ? AND type = 'ingredient';", accountID); err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// AddIngredientListItems adds passed ingredients to the db
func AddIngredientListItems(userID string, ingredients map[string]*common.ListIngredient, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		fmt.Println("could not add ingredients to shopping list")
		return err
	}

	sqlStr := "INSERT INTO list(account_id, name, type, quantity, department, is_bought, recipe_id, unit_id) VALUES "
	vals := []interface{}{}

	for name, val := range ingredients {
		sqlStr += "(?, ?, 'ingredient', ?, ?, false, ?, (SELECT id from unit where name=?)),"
		vals = append(vals, accountID, name, val.Quantity, val.Department, val.RecipeID, val.Unit)
	}

	sqlStr = sqlStr[0 : len(sqlStr)-1]
	if _, err := db.Exec(sqlStr, vals...); err != nil {
		fmt.Println(err)
		fmt.Println("could not add ingredients to shopping list")
		return err
	}
	return nil
}

// AddExtraListItem inserts an item of type 'extra'
func AddExtraListItem(userID string, name string, isBought bool, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	query := `
		INSERT INTO list
			(account_id, name, type, quantity, department, is_bought, unit_id)
			VALUES (?, ?, ?, ?, '', ?, ?)
	`
	if _, err := db.Exec(query, accountID, name, "extra", 0, isBought, 1); err != nil {
		return err
	}
	return nil
}

// GetRecipesFromList returns recipes used to create the shopping list
func GetRecipesFromList(userID string, db *sql.DB) ([]string, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}

	query := "SELECT DISTINCT recipe_id FROM list WHERE account_id = ? and type = 'ingredient';"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}

	recipes := make([]string, 0)
	for results.Next() {
		var recipe string
		err = results.Scan(&recipe)
		if err != nil {
			return nil, err
		}
		recipes = append(recipes, recipe)
	}
	return recipes, nil
}

// GetIngredientListItems returns items of type 'ingredient'
func GetIngredientListItems(userID string, db *sql.DB) (map[string]*common.ListIngredient, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}

	query := "SELECT list.name as name, unit.name as unit, quantity, department, is_bought as isBought FROM list INNER JOIN unit on unit_id = unit.id WHERE account_id = ? and type = 'ingredient';"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}

	items := make([]ListItem, 0)

	for results.Next() {
		item := ListItem{}
		err = results.Scan(&item.Name, &item.Unit, &item.Quantity, &item.Department, &item.IsBought)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	ingredientList := make(map[string]*common.ListIngredient)
	for _, item := range items {
		newItem := common.ListIngredient{
			Unit:       item.Unit,
			Quantity:   item.Quantity,
			Department: item.Department,
			IsBought:   item.IsBought,
		}
		ingredientList[item.Name] = &newItem
	}

	return ingredientList, nil
}

// GetExtraListItems returns items of type 'extra'
func GetExtraListItems(userID string, db *sql.DB) (map[string]*common.ListIngredient, error) {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return nil, err
	}
	query := "SELECT list.name as name, unit.name as unit, quantity, department, is_bought as isBought FROM list INNER JOIN unit on unit_id = unit.id WHERE account_id = ? and type = 'extra';"
	results, err := db.Query(query, accountID)

	if err != nil {
		return nil, err
	}

	items := make([]ListItem, 0)

	for results.Next() {
		item := ListItem{}
		err = results.Scan(&item.Name, &item.Unit, &item.Quantity, &item.Department, &item.IsBought)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	extrasList := make(map[string]*common.ListIngredient)
	for _, item := range items {
		newItem := common.ListIngredient{
			Unit:     item.Unit,
			Quantity: item.Quantity,
			IsBought: item.IsBought,
		}
		extrasList[item.Name] = &newItem
	}
	return extrasList, nil
}

// BuyListItem toggles the isBought state of a list item in the db
func BuyListItem(userID string, name string, isBought bool, db *sql.DB) error {
	accountID, err := GetAccountID(db, userID)
	if err != nil {
		return err
	}
	if _, err := db.Exec("UPDATE list SET is_bought = ? WHERE name = ? AND account_id = ?", isBought, name, accountID); err != nil {
		return err
	}
	return nil
}
