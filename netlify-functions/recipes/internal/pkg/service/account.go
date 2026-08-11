package service

import (
	"context"
	"database/sql"
	"log"
	"recipes/internal/pkg/common"
)

// CreateAccount creates a new account for a user
func CreateAccount(ctx context.Context, db *sql.DB, user common.User) error {
	var accountID int
	accountQuery := `SELECT account_id FROM account_user WHERE user_id = ?`
	err := db.QueryRowContext(ctx, accountQuery, user.ID).Scan(accountID)
	if err != nil && err == sql.ErrNoRows {
		// create a new account
		res, _ := db.ExecContext(ctx, `INSERT INTO account (id) VALUES (null)`)
		id, _ := res.LastInsertId()
		accountID = int(id)
		accountUserQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?, ?)`
		_, err = db.ExecContext(ctx, accountUserQuery, user.ID, accountID)
		if err != nil {
			log.Println("Error creating new account")
			return err
		}
	}
	return nil
}

// GetAccountID returns the account ID for a user
func GetAccountID(ctx context.Context, db dbConn, userID string) (int, error) {
	var accountID int
	accountQuery := `SELECT account_id from account_user WHERE user_id = ? AND enabled = true;`
	if err := db.QueryRowContext(ctx, accountQuery, userID).Scan(&accountID); err != nil {
		// TODO: Return an error of type unknown user
		return 0, err
	}
	return accountID, nil
}

func GetAccount(ctx context.Context, db *sql.DB, userID string) (a *common.Account, e error) {
	accountID, err := GetAccountID(ctx, db, userID)

	if err != nil {
		log.Println("Error querying account table")
		return nil, err
	}

	accountQuery := `
		SELECT user_id, name FROM account_user
			LEFT JOIN user on user.id = account_user.user_id
			WHERE account_id = ? AND enabled = true;
	`
	results, err := db.QueryContext(ctx, accountQuery, accountID)

	if err != nil {
		log.Println("Error querying account table")
		return nil, err
	}
	defer results.Close()

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

func AddUserToAccount(ctx context.Context, db *sql.DB, accountID int, user common.User) error {
	// TODO: if the user doesn't exist in our user table we need to add them first
	// Exec, not Query: these are writes, and Query returns an *sql.Rows that
	// nothing closed - holding the connection until the garbage collector got
	// to it. The first one's error was also being discarded entirely.
	userQuery := `INSERT INTO user (id, name) VALUES (?,?) ON DUPLICATE KEY UPDATE id=id;`
	if _, err := db.ExecContext(ctx, userQuery, user.ID, user.Name); err != nil {
		log.Println("Error adding user")
		log.Println(err)
		return err
	}

	accountQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?,?);`
	_, err := db.ExecContext(ctx, accountQuery, user.ID, accountID)
	if err != nil {
		log.Println("Error adding user to account")
		log.Println(err)
		return err
	}
	return nil
}

func DisableUserAccount(ctx context.Context, db *sql.DB, user common.User) error {
	query := `UPDATE account_user SET enabled = false WHERE user_id = ?`
	_, err := db.ExecContext(ctx, query, user.ID)
	if err != nil {
		log.Println("Error disable user account")
		log.Println(err)
		return err
	}
	return nil
}

func RemoveUserFromAccount(ctx context.Context, db *sql.DB, accountID int, user common.User) error {
	accountQuery := `DELETE FROM account_user WHERE user_id = ? AND account_id = ?;`
	_, err := db.ExecContext(ctx, accountQuery, user.ID, accountID)
	if err != nil {
		log.Println("Error removing user from account")
		return err
	}
	return nil
}
