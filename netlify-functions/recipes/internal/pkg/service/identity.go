package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// querier is the read half dbConn does not cover: SubjectsFor returns a set
// rather than a single row, and both *sql.DB and *sql.Tx satisfy this.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
}

// canonicalUserQuery maps an Auth0 subject to the person who signs in with it.
//
// Held apart from the function so a test can assert on the statement itself:
// the whole of identity resolution is this one lookup, and the properties that
// matter - that it keys on the subject and returns a user id, never the reverse
// - are invisible by inspection once it is inlined.
const canonicalUserQuery = `SELECT user_id FROM user_identity WHERE subject = ?;`

// ErrUnknownSubject means this Auth0 subject has never been seen.
//
// Not an error in itself: it is the state every genuinely new person is in
// until POST /user runs. It is only a fault on the routes that assume a User
// already exists, which is why it is a named sentinel rather than a bare
// sql.ErrNoRows - the two are the same condition and want different handling by
// different callers.
var ErrUnknownSubject = errors.New("no user is known for this auth0 subject")

// CanonicalUserID resolves an Auth0 subject to the `user.id` it belongs to.
//
// **This is the indirection the whole multi-provider design rests on.** Before
// `user_identity` existed the subject *was* the user id, so signing in through
// a second provider produced a second person. Now two subjects can name one,
// and every table that references `user.id` keeps working unchanged because it
// still sees a single user - see migrations/043_user_identity.sql for why the
// alias lives above `user` rather than beside it in `account_user`.
//
// Deliberately a pure lookup with no fallback and no writes. A GET must not
// create an identity, and "unmapped" must not silently resolve to the subject
// itself: that fallback is exactly the bug this replaced, where an unrecognised
// subject quietly became a new person with a new empty Account.
func CanonicalUserID(ctx context.Context, db dbConn, subject string) (string, error) {
	var userID string
	err := db.QueryRowContext(ctx, canonicalUserQuery, subject).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUnknownSubject
	}
	if err != nil {
		return "", fmt.Errorf("resolving the auth0 subject to a user: %w", err)
	}
	return userID, nil
}

// userWithEmailQuery finds the person already holding an address, if anybody is.
//
// LOWER() on both sides because migrations/040 puts the column in utf8mb4_bin,
// where `A` and `a` are different characters and providers do not agree on the
// case they hand back. A missed match here is not a missed feature - it is a
// person handed an empty Account.
//
// **At most one row, guaranteed by the database rather than by this query.**
// migrations/044 makes `user.email` unique, so LIMIT 1 here describes the data
// rather than choosing between candidates. Before that constraint it would have
// been a silent choice about whose recipes an arriving login could read, which
// is why this used to return every match and refuse when there was more than
// one.
const userWithEmailQuery = `SELECT id FROM user WHERE LOWER(email) = LOWER(?) LIMIT 1;`

// LinkOrCreateIdentity is what a login resolves to, and it is the only writer of
// `user_identity`.
//
// Three outcomes, in the order they are checked:
//
//  1. **The subject is known.** Nothing to do; this is every login after the
//     first. Reports the person it belongs to.
//  2. **The subject is new and the verified address belongs to exactly one
//     existing person.** They have signed in with a second provider, so the
//     subject is linked to them and they keep their Account and every Recipe in
//     it. This is the case the whole change exists for.
//  3. **The subject is new and the address is unknown.** A genuinely new person:
//     a `user` row, its identity row, and an Account.
//
// There is deliberately no fourth outcome for "several people hold this
// address": migrations/044 makes that state impossible, so handling it would be
// unreachable code claiming to defend against something the database already
// forbids.
//
// **The address must already have been verified by the caller.** This function
// takes it on trust because it cannot check - app.verifiedEmail is what
// establishes it, out of a signed claim rather than a request body. Passing an
// address a caller supplied would turn case 2 into an account-takeover
// primitive: claim somebody's address, get linked to them, read their recipes.
//
// **Transactional, and it has to be.** Case 3 writes three rows across three
// tables and case 2 writes one that grants access to an existing Account.
// Half-applied, the first leaves a user with no Account - which
// common.Caller.AccountID surfaces as a 500 on every subsequent request - and
// there is no path that would repair it, because the next login takes case 1
// and finds the subject already known.
func LinkOrCreateIdentity(ctx context.Context, db *sql.DB, subject, verifiedEmail, name string, timezone any) (userID string, created bool, err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", false, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// 1. A known subject. The overwhelmingly common path - POST /user runs on
	//    every login, not just the first.
	existing, err := CanonicalUserID(ctx, tx, subject)
	if err == nil {
		if err := refreshUser(ctx, tx, existing, name); err != nil {
			return "", false, err
		}
		// The repair path - see EnsureAccount. A no-op for everybody whose rows
		// were written correctly, which is everybody created since this function
		// existed.
		if err := EnsureAccount(ctx, tx, existing); err != nil {
			return "", false, err
		}
		if err := tx.Commit(); err != nil {
			return "", false, fmt.Errorf("committing the login: %w", err)
		}
		return existing, false, nil
	}
	if !errors.Is(err, ErrUnknownSubject) {
		return "", false, err
	}

	// 1b. A subject that is *itself* an existing `user.id`, with no identity row.
	//
	// **Self-healing for rows that predate the alias table.** migrations/043
	// backfills one identity row per user, so this should never fire in
	// production - but the backfill runs once, against whatever `user` held at
	// the time, and a row restored into the database afterwards would miss it.
	// scripts/ensure-db-current.sh does exactly that locally: it replays the
	// migrations against an empty database and *then* restores the dumped rows,
	// so any user who is not also created by a migration or the dev seed comes
	// back without an identity. Without this they could never sign in again -
	// ResolveCaller finds nothing, and every route 500s.
	//
	// **This is not the dangerous fallback.** That one was "an unrecognised
	// subject becomes a new person", which is what hands somebody an empty
	// Account. This adopts a subject only when a user row already carries that
	// exact id, which is precisely what the backfill asserts and is only ever
	// true of a row written before aliasing existed. Anyone able to present the
	// subject is already that Auth0 user, so it grants nothing they did not have.
	var legacy string
	err = tx.QueryRowContext(ctx, `SELECT id FROM user WHERE id = ?;`, subject).Scan(&legacy)
	if err == nil {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_identity (subject, user_id) VALUES (?, ?);`, subject, legacy); err != nil {
			return "", false, fmt.Errorf("recording a pre-existing user's identity: %w", err)
		}
		if err := refreshUser(ctx, tx, legacy, name); err != nil {
			return "", false, err
		}
		if err := EnsureAccount(ctx, tx, legacy); err != nil {
			return "", false, err
		}
		if err := tx.Commit(); err != nil {
			return "", false, fmt.Errorf("committing the recovered identity: %w", err)
		}
		return legacy, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", false, fmt.Errorf("looking for a pre-aliasing user row: %w", err)
	}

	// 2. A new subject on an address somebody already has.
	//
	// The link, and it is one row: from here on this subject resolves to a
	// person who already has an Account, so nothing downstream can tell the two
	// logins apart. **No new Account and no new `user` row** - creating either is
	// the failure being prevented, not a step towards preventing it.
	owner, err := userWithEmail(ctx, tx, verifiedEmail)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	if err == nil {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_identity (subject, user_id) VALUES (?, ?);`, subject, owner); err != nil {
			return "", false, fmt.Errorf("linking the new subject to an existing user: %w", err)
		}
		if err := refreshUser(ctx, tx, owner, name); err != nil {
			return "", false, err
		}
		if err := EnsureAccount(ctx, tx, owner); err != nil {
			return "", false, err
		}
		if err := tx.Commit(); err != nil {
			return "", false, fmt.Errorf("committing the identity link: %w", err)
		}
		return owner, false, nil
	}

	// 3. A genuinely new person.
	//
	// `user.id` is the subject, which keeps the shape every existing row already
	// has and makes migrations/043's backfill the identity mapping. It is now
	// only a *default*: the second subject this person signs in with will alias
	// to this same id rather than replacing it.
	if err := insertUser(ctx, tx, subject, name, verifiedEmail, timezone); err != nil {
		return "", false, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_identity (subject, user_id) VALUES (?, ?);`, subject, subject); err != nil {
		return "", false, fmt.Errorf("recording the new user's identity: %w", err)
	}
	if err := EnsureAccount(ctx, tx, subject); err != nil {
		return "", false, err
	}
	if err := tx.Commit(); err != nil {
		return "", false, fmt.Errorf("committing the new user: %w", err)
	}
	return subject, true, nil
}

// userWithEmail returns the person holding this address, or sql.ErrNoRows.
func userWithEmail(ctx context.Context, tx *sql.Tx, email string) (string, error) {
	var id string
	if err := tx.QueryRowContext(ctx, userWithEmailQuery, email).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		return "", fmt.Errorf("looking for an existing user with this email: %w", err)
	}
	return id, nil
}

// insertUser writes the `user` row for a genuinely new person.
//
// **timezone is written here and nowhere else**, which is the rule
// migrations/037 exists to state: the onboarding sequence sends at 10:00 in the
// recipient's morning across a fortnight, and someone logging in from Tokyo on
// day 4 should not have days 8 and 14 shifted by nine hours. refreshUser below
// deliberately does not touch it.
func insertUser(ctx context.Context, tx *sql.Tx, id, name, email string, timezone any) error {
	const query = `INSERT INTO user (id, name, email, timezone) VALUES (?, ?, ?, ?);`
	if _, err := tx.ExecContext(ctx, query, id, name, email, timezone); err != nil {
		return fmt.Errorf("creating the user: %w", err)
	}
	return nil
}

// refreshUser updates what a login can legitimately change about a person.
//
// **The email is deliberately absent**, and that is a change from the upsert
// this replaced. It refreshed `email` on every login, which is what let a
// caller rewrite their own address and made `invite.email` matching an
// authorisation hole. The address is now written once, at signup, from a
// verified claim.
//
// The practical consequence is that changing your email address at your
// identity provider no longer changes it here. That is the right trade for now
// - the address is what invitations are matched on, so a login must not be able
// to move it - and a deliberate account-settings route is the place to revisit
// it.
func refreshUser(ctx context.Context, tx *sql.Tx, id, name string) error {
	const query = `UPDATE user SET name = ?, last_logged_in_at = CURRENT_TIMESTAMP WHERE id = ?;`
	if _, err := tx.ExecContext(ctx, query, name, id); err != nil {
		return fmt.Errorf("refreshing the user: %w", err)
	}
	return nil
}

// SubjectsFor lists every Auth0 subject a person signs in with.
//
// Erasure needs it: DeleteAuth0User removes one subject, and somebody who has
// linked a second provider has more than one. Deleting only the one they
// happened to log in with would leave a working login for an account that no
// longer exists - the exact defect the AUTH0_MGMT board item closed once
// already, reopened by aliasing unless this is used.
func SubjectsFor(ctx context.Context, db querier, userID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT subject FROM user_identity WHERE user_id = ?;`, userID)
	if err != nil {
		return nil, fmt.Errorf("listing the user's auth0 subjects: %w", err)
	}
	defer rows.Close()

	var subjects []string
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			return nil, fmt.Errorf("reading an auth0 subject: %w", err)
		}
		subjects = append(subjects, subject)
	}
	return subjects, rows.Err()
}

// resolveCallerQuery answers "who is this, and which Account are they in" in one
// round trip.
//
// **A LEFT JOIN, and the direction matters.** `user_identity` is the anchor
// because the subject is the only thing the request actually carries; the
// membership is optional because a person can legitimately exist without a
// reachable Account - between the deletion sequence's soft gate and its cascade,
// and for the one request before POST /user has run. Those two cases have to be
// distinguishable from "this subject is a stranger", and an inner join would
// collapse all three into no rows.
//
// `enabled = true` on the join rather than in a WHERE clause, for the same
// reason: a disabled membership must yield a known person with no Account, not
// an unknown person.
const resolveCallerQuery = `
	SELECT ui.user_id, au.account_id
		FROM user_identity ui
		LEFT JOIN account_user au
			ON au.user_id = ui.user_id AND au.enabled = true
		WHERE ui.subject = ?;
`

// ResolveCaller is the single lookup behind common.Caller.
//
// Returns ErrUnknownSubject when nobody signs in with this subject, and
// sql.ErrNoRows for the account when the person exists but can currently reach
// no Account - which is what every account-scoped handler already turns into a
// 500, unchanged from when service.GetAccountID answered on its own.
func ResolveCaller(ctx context.Context, db dbConn, subject string) (userID string, accountID int, err error) {
	var account sql.NullInt64
	err = db.QueryRowContext(ctx, resolveCallerQuery, subject).Scan(&userID, &account)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrUnknownSubject
	}
	if err != nil {
		return "", 0, fmt.Errorf("resolving the caller: %w", err)
	}
	if !account.Valid {
		return userID, 0, sql.ErrNoRows
	}
	return userID, int(account.Int64), nil
}

// providerNames maps an Auth0 connection prefix to something a person would
// recognise.
//
// **The prefix is the connection, not the provider**, which is why this is a
// table rather than a title-case of whatever precedes the "|". Auth0 spells
// Microsoft's consumer connection `windowslive` and its own database connection
// `auth0`, and neither is a name to put in an email.
var providerNames = map[string]string{
	"google-oauth2": "Google",
	"apple":         "Apple",
	"windowslive":   "Microsoft",
	"facebook":      "Facebook",
	"github":        "GitHub",
	"linkedin":      "LinkedIn",
	// The username/password connection. Called out because "Auth0" is a name a
	// user has never seen and would read as a third party.
	"auth0": "email and password",
}

// ProviderName is how a sign-in method is named to the person who owns it.
//
// **It returns "" rather than a guess for anything unrecognised**, and every
// caller has to handle that. The alternative - falling back to the raw prefix -
// puts a connection name nobody chose into a sentence somebody is being asked
// to make a security decision about, and a wrong or cryptic name there is worse
// than no name: the whole job of the confirmation screen is to be believable.
//
// Adding a connection to the Auth0 tenant therefore means adding it here, and
// the failure of forgetting is a vaguer sentence rather than a broken one.
func ProviderName(subject string) string {
	prefix, _, found := strings.Cut(subject, "|")
	if !found {
		return ""
	}
	return providerNames[prefix]
}
