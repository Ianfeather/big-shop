package service

import (
	"context"
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/telemetry"
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
	// account_id is joined in rather than fetched separately, and that is the
	// point: common.Caller resolves it with a query of its own, so asking it
	// here would add a round trip to a route every authenticated page already
	// calls - the exact cost specs/request-model-optimisations.md spent six
	// phases removing. A LEFT JOIN keeps this one query.
	//
	// LEFT, not INNER: a user with no enabled account_user row still has to
	// come back. That is a real state - the invite flow disables someone's old
	// membership as they accept an invite elsewhere (see DisableUserAccount),
	// so there is a moment with none enabled, and account deletion's soft gate
	// leaves them that way on purpose - and an INNER JOIN would turn it into
	// "no such user" and blank their preferences.
	userQuery := `
		SELECT u.id, u.name, u.email, u.onboarded, u.show_pantry_staples, au.account_id
			FROM user u
			LEFT JOIN account_user au ON au.user_id = u.id AND au.enabled = true
			WHERE u.id = ?
	`
	user := &common.User{}

	// Scanned into a local and then pointed at, so the field is always non-nil
	// on the way out - a read of this User always states the preference,
	// including when it is false. See the field's comment in common/types.go.
	var showPantryStaples bool
	var accountID sql.NullInt64
	if err := db.QueryRowContext(ctx, userQuery, userID).Scan(&user.ID, &user.Name, &user.Email, &user.Onboarded, &showPantryStaples, &accountID); err != nil {
		return nil, err
	}
	user.ShowPantryStaples = &showPantryStaples
	if accountID.Valid {
		id := int(accountID.Int64)
		user.AccountID = &id

		// The Account's Google Analytics identifier, minted on first read. Sent
		// to Google in place of account.id - see the field's comment in
		// common/types.go and migrations/036_ga_account_uuid.sql.
		//
		// **The error is deliberately swallowed**, which is the same rule
		// ADR-0007 states for telemetry: analytics must never be the reason
		// somebody cannot load their recipes. A failure leaves AnalyticsID nil,
		// the browser names no Account to Google, and everything else on this
		// page works exactly as it did.
		if analyticsID, err := AccountAnalyticsID(ctx, db, id); err != nil {
			telemetry.RecordWarning(ctx, "mint account analytics id", err)
		} else {
			user.AnalyticsID = &analyticsID
		}
	}

	// The latest consent decision rides along on the User rather than costing a
	// route of its own - see the field's comment in common/types.go. A user who
	// has never been asked gets nil, which is not an error.
	consent, err := GetLatestConsent(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	user.Consent = consent

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
