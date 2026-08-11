package service

import (
	"context"
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
)

func AddUser(ctx context.Context, db *sql.DB, user common.User) error {
	userQuery := `
		INSERT INTO user (id, name, email)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE
				id=id,
				name=?,
				email=?,
				last_logged_in_at=CURRENT_TIMESTAMP
			;
	`
	_, err := db.ExecContext(ctx, userQuery, user.ID, user.Name, user.Email, user.Name, user.Email)
	if err != nil {
		return fmt.Errorf("adding user: %w", err)
	}
	return nil
}

func GetUser(ctx context.Context, db *sql.DB, userID string) (u *common.User, e error) {
	userQuery := `SELECT id, name, email, onboarded, show_pantry_staples FROM user WHERE id = ?`
	user := &common.User{}

	// Scanned into a local and then pointed at, so the field is always non-nil
	// on the way out - a read of this User always states the preference,
	// including when it is false. See the field's comment in common/types.go.
	var showPantryStaples bool
	if err := db.QueryRowContext(ctx, userQuery, userID).Scan(&user.ID, &user.Name, &user.Email, &user.Onboarded, &showPantryStaples); err != nil {
		return nil, err
	}
	user.ShowPantryStaples = &showPantryStaples
	return user, nil
}

// SetShowPantryStaples records whether this user wants the Shopping List's
// Pantry Staples group opened.
//
// Takes the value rather than only ever setting true, unlike SetOnboarded above:
// onboarding happens once and never un-happens, while this is a preference the
// same person flips back and forth.
func SetShowPantryStaples(ctx context.Context, db *sql.DB, userID string, show bool) error {
	query := `UPDATE user SET show_pantry_staples = ? WHERE id = ?`
	_, err := db.ExecContext(ctx, query, show, userID)
	if err != nil {
		return fmt.Errorf("setting user show_pantry_staples: %w", err)
	}
	return nil
}

// SetOnboarded marks a user as having completed the onboarding screen.
func SetOnboarded(ctx context.Context, db *sql.DB, userID string) error {
	query := `UPDATE user SET onboarded = true WHERE id = ?`
	_, err := db.ExecContext(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("setting user onboarded: %w", err)
	}
	return nil
}
