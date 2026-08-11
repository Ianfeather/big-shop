package service

import (
	"context"
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
)

// CreateAccount creates a new account for a user
func CreateAccount(ctx context.Context, db *sql.DB, user common.User) error {
	var accountID int
	accountQuery := `SELECT account_id FROM account_user WHERE user_id = ?`
	err := db.QueryRowContext(ctx, accountQuery, user.ID).Scan(accountID)
	if err != nil && err == sql.ErrNoRows {
		// create a new account
		res, err := db.ExecContext(ctx, `INSERT INTO account (id) VALUES (null)`)
		if err != nil {
			return fmt.Errorf("creating account: %w", err)
		}
		id, err := res.LastInsertId()
		if err != nil {
			return fmt.Errorf("reading new account id: %w", err)
		}
		accountID = int(id)
		accountUserQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?, ?)`
		if _, err := db.ExecContext(ctx, accountUserQuery, user.ID, accountID); err != nil {
			return fmt.Errorf("linking user to new account: %w", err)
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
		return nil, fmt.Errorf("resolving account: %w", err)
	}

	accountQuery := `
		SELECT user_id, name FROM account_user
			LEFT JOIN user on user.id = account_user.user_id
			WHERE account_id = ? AND enabled = true;
	`
	results, err := db.QueryContext(ctx, accountQuery, accountID)

	if err != nil {
		return nil, fmt.Errorf("querying the account's users: %w", err)
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
		return fmt.Errorf("adding user: %w", err)
	}

	accountQuery := `INSERT INTO account_user (user_id, account_id) VALUES (?,?);`
	_, err := db.ExecContext(ctx, accountQuery, user.ID, accountID)
	if err != nil {
		return fmt.Errorf("adding user to account: %w", err)
	}
	return nil
}

func DisableUserAccount(ctx context.Context, db *sql.DB, user common.User) error {
	query := `UPDATE account_user SET enabled = false WHERE user_id = ?`
	_, err := db.ExecContext(ctx, query, user.ID)
	if err != nil {
		return fmt.Errorf("disabling user account: %w", err)
	}
	return nil
}

func RemoveUserFromAccount(ctx context.Context, db *sql.DB, accountID int, user common.User) error {
	accountQuery := `DELETE FROM account_user WHERE user_id = ? AND account_id = ?;`
	_, err := db.ExecContext(ctx, accountQuery, user.ID, accountID)
	if err != nil {
		return fmt.Errorf("removing user from account: %w", err)
	}
	return nil
}
