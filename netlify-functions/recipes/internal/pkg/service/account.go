package service

import (
	"database/sql"
	"log"
	"recipes/internal/pkg/common"
)

// CreateAccount creates a new account for a user
func CreateAccount(db *sql.DB, user common.User) error {
	var accountID int
	accountQuery := `SELECT account_id FROM account_user WHERE user_id = ?`
	err := db.QueryRow(accountQuery, user.ID).Scan(accountID)
	if err != nil && err == sql.ErrNoRows {
		// create a new account
		res, _ := db.Exec(`INSERT INTO account (id) VALUES (null)`)
		id, _ := res.LastInsertId()
		accountID = int(id)
		accountUserQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?, ?)`
		_, err = db.Exec(accountUserQuery, user.ID, accountID)
		if err != nil {
			log.Println("Error creating new account")
			return err
		}
	}
	return nil
}

// GetAccountID returns the account ID for a user
func GetAccountID(db *sql.DB, userID string) (int, error) {
	var accountID int
	accountQuery := `SELECT account_id from account_user WHERE user_id = ? AND enabled = true;`
	if err := db.QueryRow(accountQuery, userID).Scan(&accountID); err != nil {
		// TODO: Return an error of type unknown user
		return 0, err
	}
	return accountID, nil
}

func GetAccount(db *sql.DB, userID string) (a *common.Account, e error) {
	accountID, err := GetAccountID(db, userID)

	if err != nil {
		log.Println("Error querying account table")
		return nil, err
	}

	accountQuery := `
		SELECT user_id, name FROM account_user
			LEFT JOIN user on user.id = account_user.user_id
			WHERE account_id = ? AND enabled = true;
	`
	results, err := db.Query(accountQuery, accountID)

	if err != nil {
		log.Println("Error querying account table")
		return nil, err
	}

	users := make([]common.User, 0)

	for results.Next() {
		user := common.User{}
		err = results.Scan(&user.ID, &user.Name)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	account := &common.Account{
		ID:    accountID,
		Users: users,
	}
	return account, nil
}

func AddUserToAccount(db *sql.DB, accountID int, user common.User) error {
	// TODO: if the user doesn't exist in our user table we need to add them first
	userQuery := `INSERT INTO user (id, name) VALUES (?,?) ON DUPLICATE KEY UPDATE id=id;`
	_, err := db.Query(userQuery, user.ID, user.Name)

	accountQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?,?);`
	_, err = db.Query(accountQuery, user.ID, accountID)
	if err != nil {
		log.Println("Error adding user to account")
		log.Println(err)
		return err
	}
	return nil
}

func DisableUserAccount(db *sql.DB, user common.User) error {
	query := `UPDATE account_user SET enabled = false WHERE user_id = ?`
	_, err := db.Exec(query, user.ID)
	if err != nil {
		log.Println("Error disable user account")
		log.Println(err)
		return err
	}
	return nil
}

func RemoveUserFromAccount(db *sql.DB, accountID int, user common.User) error {
	accountQuery := `DELETE FROM user_account WHERE user_id = ? AND account_id = ?;`
	_, err := db.Query(accountQuery, user.ID, accountID)
	if err != nil {
		log.Println("Error adding user to account")
		return err
	}
	return nil
}
