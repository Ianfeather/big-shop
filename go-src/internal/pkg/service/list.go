package service

import (
	"big-shop/go-src/internal/pkg/common"
	"fmt"

	"database/sql"
)

// ListItem is used to interface with the DB
type ListItem struct {
	Name     string
	Unit     string
	Quantity float64
	IsBought bool
}

// RemoveAllListItems removes all list items for a user
func RemoveAllListItems(userID int, db *sql.DB) error {
	stmt, err := db.Prepare("DELETE FROM list WHERE user_id = ?;")
	if err != nil {
		return err
	}

	_, err = stmt.Exec(userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// RemoveIngredientListItems removes all ingredient list items
func RemoveIngredientListItems(userID int, db *sql.DB) error {
	stmt, err := db.Prepare("DELETE FROM list WHERE user_id = ? AND type = 'ingredient';")
	if err != nil {
		return err
	}

	_, err = stmt.Exec(userID)
	if err != nil {
		fmt.Println("could not delete ingredients")
		return err
	}
	return nil
}

// AddIngredientListItems adds passed ingredients to the db
func AddIngredientListItems(userID int, ingredients map[string]*common.ListIngredient, db *sql.DB) error {
	sqlStr := "INSERT INTO list(user_id, name, type, quantity, is_bought, recipe_id, unit_id) VALUES "
	vals := []interface{}{}

	for name, val := range ingredients {
		sqlStr += "(?, ?, 'ingredient', ?, false, ?, (SELECT id from unit where name=?)),"
		vals = append(vals, userID, name, val.Quantity, val.RecipeID, val.Unit)
	}

	sqlStr = sqlStr[0 : len(sqlStr)-1]
	stmt, err := db.Prepare(sqlStr)
	if err != nil {
		return err
	}

	_, err = stmt.Exec(vals...)
	if err != nil {
		fmt.Println(err)
		fmt.Println("could not add ingredients to shopping list")
		return err
	}
	return nil
}

// AddExtraListItem inserts an item of type 'extra'
func AddExtraListItem(userID int, name string, isBought bool, db *sql.DB) error {
	stmt, err := db.Prepare("INSERT INTO list(user_id, name, type, quantity, is_bought, unit_id) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id;")
	if err != nil {
		return err
	}

	_, err = stmt.Exec(userID, name, "extra", 0, isBought, 1)
	if err != nil {
		return err
	}
	return nil
}

// GetRecipesFromList returns recipes used to create the shopping list
func GetRecipesFromList(userID int, db *sql.DB) ([]string, error) {
	ingredientQuery := "SELECT DISTINCT recipe_id FROM list WHERE user_id = ? and type = 'ingredient';"
	results, err := db.Query(ingredientQuery, userID)

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
func GetIngredientListItems(userID int, db *sql.DB) (map[string]*common.ListIngredient, error) {
	ingredientQuery := "SELECT list.name as name, unit.name as unit, quantity, is_bought as isBought FROM list INNER JOIN unit on unit_id = unit.id WHERE user_id = ? and type = 'ingredient';"
	results, err := db.Query(ingredientQuery, userID)

	items := make([]ListItem, 0)

	for results.Next() {
		item := ListItem{}
		err = results.Scan(&item.Name, &item.Unit, &item.Quantity, &item.IsBought)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	ingredientList := make(map[string]*common.ListIngredient)
	for _, item := range items {
		newItem := common.ListIngredient{
			Unit:     item.Unit,
			Quantity: item.Quantity,
			IsBought: item.IsBought,
		}
		ingredientList[item.Name] = &newItem
	}

	return ingredientList, nil
}

// GetExtraListItems returns items of type 'extra'
func GetExtraListItems(userID int, db *sql.DB) (map[string]*common.ListIngredient, error) {
	ingredientQuery := "SELECT list.name as name, unit.name as unit, quantity, is_bought as isBought FROM list INNER JOIN unit on unit_id = unit.id WHERE user_id = ? and type = 'extra';"
	results, err := db.Query(ingredientQuery, userID)

	items := make([]ListItem, 0)

	for results.Next() {
		item := ListItem{}
		err = results.Scan(&item.Name, &item.Unit, &item.Quantity, &item.IsBought)
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
func BuyListItem(userID int, name string, isBought bool, db *sql.DB) error {
	stmt, err := db.Prepare("UPDATE list SET is_bought = ? WHERE name = ? AND user_id = ?")
	if err != nil {
		return err
	}
	_, err = stmt.Exec(isBought, name, userID)
	if err != nil {
		return err
	}
	return nil
}
