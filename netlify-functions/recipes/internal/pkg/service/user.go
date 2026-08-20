package service

import (
	"context"
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/telemetry"
	"time"
)

// AddUser upserts the signed-in User. Called on every login, not just the first
// one (see pages/index.tsx), so the UPDATE half runs far more often than the
// INSERT half.
//
// **timezone is in the INSERT and deliberately absent from the UPDATE.** Every
// other column here is refreshed on each login - a changed display name or
// email should win, and last_logged_in_at is the whole point of re-running this
// - but the zone is captured once, at signup, and then left alone. The
// onboarding email sequence sends at 10:00 in the recipient's morning across a
// fortnight, and someone logging in from Tokyo on day 4 should not have days 8
// and 14 shifted by nine hours. The accepted cost is a stale column for anyone
// who genuinely relocates, which for a fourteen-day sequence is close to
// irrelevant. See migrations/037_user_timezone.sql and specs/completed/email.md.
//
// Passing an empty timezone is normal rather than a fault: the frontend sends
// whatever Intl.DateTimeFormat reports and some browsers report nothing, so the
// column is nullable and every reader falls back to Europe/London. It is stored
// as NULL rather than "" so the two states cannot be told apart later by
// accident - there is no meaningful difference between "the browser declined"
// and "this row predates the column", and both take the same fallback.
// Reports whether this call actually created the User, as opposed to refreshing
// one who already existed.
//
// The caller needs it because this runs on *every* login, not just the first,
// and the welcome email must be attempted exactly once. MySQL's ROW_COUNT for
// INSERT ... ON DUPLICATE KEY UPDATE is 1 for an insert, 2 for an update that
// changed something, and 0 for one that did not - verified against the database
// rather than taken from the manual, because sending a welcome email on every
// login is the kind of bug that is only discovered by its recipients.
func AddUser(ctx context.Context, db *sql.DB, user common.User) (created bool, err error) {
	query, args := userUpsert(user)
	result, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return false, fmt.Errorf("adding user: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		// The row is written either way; only the "was it new" signal is lost.
		// Reporting "not new" means no welcome email rather than a duplicate
		// one, and the ticker picks it up at 10:00 their time regardless - so
		// the safe answer costs at most a few hours' delay.
		return false, nil
	}
	return affected == 1, nil
}

// userUpsert builds the statement and its arguments.
//
// Split out from AddUser purely so it can be tested without a database. The two
// things worth pinning are invisible by inspection and easy to break by
// accident: that the arguments line up with the placeholders across a statement
// with two parameter groups, and that `timezone` appears in the INSERT list and
// nowhere in the UPDATE list. The second is the entire behaviour Phase 1b
// exists to provide, and a later edit to this upsert would silently undo it.
func userUpsert(user common.User) (string, []any) {
	const query = `
		INSERT INTO user (id, name, email, timezone)
			VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				id=id,
				name=?,
				email=?,
				last_logged_in_at=CURRENT_TIMESTAMP
			;
	`
	return query, []any{
		user.ID, user.Name, user.Email, normaliseTimezone(user.Timezone),
		user.Name, user.Email,
	}
}

// normaliseTimezone turns a client-supplied zone into something safe to store,
// or nil for SQL NULL.
//
// The value arrives from the browser on POST /user and is otherwise
// unconstrained, which makes it the one field on that request a caller can use
// to break their own signup. Two ways, both closed here:
//
//   - **Too long.** The column is varchar(64) and TiDB is strict, so a longer
//     value fails the INSERT outright. That turns POST /user into a 500 - and
//     since pages/index.tsx swallows the failure, the User row and their Account
//     are never created and the person simply cannot sign up. Over a field that
//     only decides what hour an email arrives.
//   - **Not a real zone.** "Neptune/Deep_Space" stores perfectly happily and
//     then fails when the sender calls time.LoadLocation on it, weeks later, on
//     a machine nobody is watching. Better to refuse it now and fall back.
//
// Rejected as the fix: a `maxLength:"64"` tag on the field, which would make
// Huma answer 422 instead. That is a clearer error and still a failed signup.
// Nothing about a timezone is worth failing a registration over, so anything
// not vouched for becomes NULL and the sender falls back to Europe/London.
//
// "Local" is refused along with the empty string: time.LoadLocation accepts both
// and resolves them against the *server's* zone, which would silently make every
// such user's mail arrive at 10:00 Frankfurt.
func normaliseTimezone(tz string) any {
	if tz == "" || tz == "Local" || len(tz) > 64 {
		return nil
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return nil
	}
	return tz
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
	// timezone is deliberately NOT selected here, though the column exists and
	// this is the obvious place to read it from.
	//
	// It has no reader on this path: the email programme's due-query reads the
	// column directly, and nothing in the frontend uses it. Selecting it anyway
	// would put a location signal - coarse, but a location signal - into every
	// GET /user and POST /user response body and into the browser's query cache,
	// for nothing. specs/completed/email.md's whole justification for storing it is that
	// "it goes no further than our database", so shipping it to the client by
	// default would quietly weaken the claim that made storing it acceptable.
	// Add it here when something actually needs it.
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
