package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"recipes/internal/pkg/common"

	"github.com/google/uuid"
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

func GetAccount(ctx context.Context, db *sql.DB, caller *common.Caller) (a *common.Account, e error) {
	accountID, err := caller.AccountID()

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
	// This is the second path that can create a `user` row, and it writes no
	// timezone. Combined with AddUser's insert-only rule - the zone is written
	// on INSERT and never on UPDATE - a row born here can never acquire one:
	// the next POST /user finds an existing row and takes the UPDATE branch,
	// which does not touch the column. Such a user falls back to Europe/London
	// for the onboarding sequence, which is the designed behaviour for an
	// unknown zone rather than a failure.
	//
	// Not live today: both callers resolve an existing user first, so this
	// INSERT is effectively a no-op guard. Recorded because "captured at
	// signup" is only true while AddUser remains the only path that really
	// creates users, and that is not enforced anywhere.
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

// DisableUserAccount takes one User out of one Account, leaving the row in
// place so the membership is recoverable.
//
// **The account scoping is the fix for a live bug**, not decoration. This used
// to be `WHERE user_id = ?` with no account at all, so it disabled *every*
// membership the user had. GetAccountID and GetAccount both filter
// `enabled = true`, so its victim was left able to log in and resolve to no
// Account whatsoever - a user with recipes, a list and no way to reach either.
// It happened not to bite only because the single caller's users had one
// membership each, which is a property of the data rather than of the code.
//
// That caller - acceptInvite in app/invites.go - is better served by the scoped
// version anyway: its intent is "disable the invitee's *old* account" before
// adding them to the new one, and it is the old account it names.
//
// Deliberately an UPDATE and not a DELETE. This is the soft gate: the Account
// becomes unreachable immediately, which is what someone deleting their account
// has actually asked for, while every irreversible step happens afterwards and
// can be retried by hand if it fails. See DeleteAccount.
func DisableUserAccount(ctx context.Context, db execer, userID string, accountID int) error {
	query := `UPDATE account_user SET enabled = false WHERE user_id = ? AND account_id = ?`
	_, err := db.ExecContext(ctx, query, userID, accountID)
	if err != nil {
		return fmt.Errorf("disabling user account: %w", err)
	}
	return nil
}

// DisableUserAccountRestore undoes DisableUserAccount.
//
// It exists for exactly one caller: the deletion sequence, when a step after
// its soft gate fails. Without it a failed deletion leaves the person unable to
// resolve an Account at all - GetAccountID filters `enabled = true` - so they
// could neither use the app nor retry the deletion that failed, which turns the
// design's "gated, retryable Account" into a bricked one.
//
// Named as the inverse of the gate rather than something like `EnableUser`
// because that is the whole of its purpose; it is not a general-purpose
// membership control, and RemoveUserFromAccount below is not its opposite.
func DisableUserAccountRestore(ctx context.Context, db execer, userID string, accountID int) error {
	query := `UPDATE account_user SET enabled = true WHERE user_id = ? AND account_id = ?`
	if _, err := db.ExecContext(ctx, query, userID, accountID); err != nil {
		return fmt.Errorf("restoring user account access: %w", err)
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

// otherMembersQuery is held apart from the function so a test can assert on the
// predicate itself - the property below lives entirely in the WHERE clause, and
// there is no way to fake *sql.Row to reach it any other way.
//
// FOR UPDATE because a plain SELECT under REPEATABLE READ - MySQL's and TiDB's
// default - is a non-locking snapshot read, so running it inside the deletion
// transaction would narrow the window for a co-member arriving or leaving
// mid-cascade without actually closing it. It must be run in a transaction for
// that to mean anything, which DeleteAccount does.
const otherMembersQuery = `SELECT COUNT(*) FROM account_user WHERE account_id = ? AND user_id != ? AND enabled = true FOR UPDATE`

// OtherAccountMembers counts the Users *other than* the given one who can
// currently reach an Account.
//
// **Excluding the subject is what makes this safe to call at any point in the
// deletion sequence, and getting it wrong destroys other people's data.** The
// obvious formulation - count enabled members, treat one as "sole" - is wrong,
// because the deletion sequence disables the departing user's own row first
// (the soft gate, DisableUserAccount above). After that step a *shared* Account
// with two members has exactly one enabled row left, so "one member means sole"
// would take the sole-member branch and delete the surviving member's Recipes
// and the Account itself.
//
// Counting only the others makes the answer independent of whether the soft
// gate has run, which in turn is what lets a partly-failed deletion be retried
// by hand without changing which branch it takes.
//
// `enabled = true` still applies to the others: a disabled row is a membership
// somebody has already left, and someone who has left is not a reason to keep
// the Account alive.
func OtherAccountMembers(ctx context.Context, db dbConn, accountID int, excludingUserID string) (int, error) {
	var members int
	if err := db.QueryRowContext(ctx, otherMembersQuery, accountID, excludingUserID).Scan(&members); err != nil {
		return 0, fmt.Errorf("counting the account's other members: %w", err)
	}
	return members, nil
}

// deleteAccountTx erases a User, and - when they are the last one - the Account
// with them.
//
// **One user-facing action, two different operations.** Per CONTEXT.md a Recipe
// belongs to an Account, not a User, and an Account can be shared. The board
// settled what that means for erasure on 2026-08-17: Recipes stay with the
// Account when a User departs, provided at least one other User remains; the
// last User leaving takes the Account and everything under it. So which
// statements run is decided by counting the Account's remaining enabled
// members, and `soleMember` is that decision already made.
//
// The shared case is the one to get right. The departing person is erased
// completely - their Auth0 subject, name, email, consent history and every
// invite addressed to them - while the Recipe content they contributed carries
// on, because it is the Account's and not theirs. Nothing of *theirs* is left
// behind.
//
// Ordering is not stylistic. `consent_event` has a foreign key to `user.id`
// (migrations/034), and `account_user` has foreign keys to both `user.id` and
// `account.id` (migrations/008), so children go before parents throughout or
// the statement fails outright.
//
// Never touched, at any point: `ingredient`, `unit`, `tag`, `department`,
// `ingredient_department`, `ingredient_unit_size`. Per ADR-0001 the Global
// Ingredient Catalog is shared by every Account and is not personal data;
// erasing "their" ingredients would damage everyone else's. A thorough
// implementer will go looking for them, which is why this says so.
//
// Takes `execer` for the same reason deleteRecipeData does - so the tests can
// drive it without a database - and carries the same obligation: **the caller
// must pass a transaction.** Half of this cascade applied is worse than none of
// it.
func deleteAccountTx(ctx context.Context, tx execer, userID string, accountID int, emailDigest string, soleMember bool) error {
	if soleMember {
		// Everything the Account owns. deleteRecipeData with nil means "every
		// Recipe in the account", which is why it exists in that shape - the
		// alternative, looping it per Recipe, is N times the queries and still
		// misses the rows below.
		if err := deleteRecipeData(ctx, tx, accountID, nil); err != nil {
			return err
		}

		// Extra Items carry no recipe_id, so deleteRecipeData's
		// `recipe_id IN (...)` predicate deliberately excluded them. Same for a
		// shopping_list_event not about a Recipe.
		if _, err := tx.ExecContext(ctx, "DELETE FROM list WHERE account_id = ?;", accountID); err != nil {
			return fmt.Errorf("deleting the account's extra items: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM shopping_list_event WHERE account_id = ?;", accountID); err != nil {
			return fmt.Errorf("deleting the account's shopping list history: %w", err)
		}

		// Invites this Account sent. Only in the sole-member case: a shared
		// Account still exists and its outstanding invites are still valid.
		if _, err := tx.ExecContext(ctx, "DELETE FROM invite WHERE account = ?;", accountID); err != nil {
			return fmt.Errorf("deleting invites sent by the account: %w", err)
		}
	}

	// Invites addressed *to* this person, across every Account - not just this
	// one. They are about them, so they go in both branches.
	//
	// Matched by digest because Phase 1 stopped storing the address. This is
	// the reuse HashEmail was extracted for.
	if _, err := tx.ExecContext(ctx, "DELETE FROM invite WHERE email = ?;", emailDigest); err != nil {
		return fmt.Errorf("deleting invites addressed to the user: %w", err)
	}

	// Invites *sent by* this person, likewise in both branches - and this one
	// goes beyond what the spec's table asks for, deliberately.
	//
	// The table says a shared Account keeps the invites it sent, which is right
	// about the Account and wrong about the person: `invite.admin_id` is the
	// sender's Auth0 subject, so keeping the row keeps an identifier belonging
	// to somebody we have just told we erased. That contradicts the promise the
	// shared branch is built on - the Recipe content stays because it is the
	// Account's, but nothing *of theirs* is left behind.
	//
	// Deleting is also better than nulling the column, which is NOT NULL, and
	// better than leaving it: `GetInvites` LEFT JOINs `user` on admin_id to
	// show who invited you, so a surviving row would render an invite from
	// nobody. The Account loses a pending invitation it can simply send again.
	if _, err := tx.ExecContext(ctx, "DELETE FROM invite WHERE admin_id = ?;", userID); err != nil {
		return fmt.Errorf("deleting invites sent by the user: %w", err)
	}

	// The consent history, before the `user` row it points at.
	//
	// **This reverses a decision recorded on the board, and the reversal is the
	// considered answer** - see migrations/034_consent_event.sql's header,
	// amended in the same change. The rows were kept to prove that *a specific
	// person* consented. Severing the link to that person, by any mechanism,
	// leaves something saying "somebody consented on this date under this
	// policy version" - which rebuts nothing if an ex-user later claims they
	// were tracked without consent. So delinking does not serve the principle
	// that motivated keeping the row; it only pays schema complexity to retain
	// something inert. The legal shape agrees: Article 7(1)'s duty to
	// demonstrate consent runs for data subjects whose data you process, and
	// after erasure you process none of theirs.
	if _, err := tx.ExecContext(ctx, "DELETE FROM consent_event WHERE user_id = ?;", userID); err != nil {
		return fmt.Errorf("deleting the user's consent history: %w", err)
	}

	// **Every membership this person holds, not just the one being deleted.**
	// `account_user` has two foreign keys and each needs clearing along its own
	// axis, which is easy to half-do:
	//
	//   - fk_account_user_user_id blocks `DELETE FROM user` while *any* row for
	//     them survives, including one pointing at a different Account. The
	//     invite flow manufactures exactly that: DisableUserAccount leaves the
	//     old membership in place with `enabled = false` and AddUserToAccount
	//     inserts a second, so every user who has ever accepted an invite has
	//     two rows. Scoping this delete to the current Account would fail the
	//     user delete below for all of them.
	//   - fk_account_user_account_id blocks `DELETE FROM account`, handled by
	//     the sole-member statement underneath.
	//
	// Removing them all is also the right behaviour on its own terms rather
	// than merely a way past a constraint: the person is being erased, so they
	// cannot go on being a member of anything, and their `user` row is about to
	// go with them.
	if _, err := tx.ExecContext(ctx, "DELETE FROM account_user WHERE user_id = ?;", userID); err != nil {
		return fmt.Errorf("deleting the user's memberships: %w", err)
	}

	if soleMember {
		// The Google Analytics identifier, in the sole-member branch only -
		// which departs from the spec's cascade list, deliberately.
		//
		// The spec puts this above the line where the shared case starts
		// skipping statements, but in the shared case the Account survives, so
		// deleting its UUID only causes a different one to be minted on the next
		// page load. That severs nothing that stays severed, and it splits the
		// surviving members' Account across two identifiers in Google. The
		// departing person's link to Google ran through the Account, and the
		// Account is staying either way.
		if _, err := tx.ExecContext(ctx, "DELETE FROM ga_account_uuid WHERE account_id = ?;", accountID); err != nil {
			return fmt.Errorf("deleting the account's analytics identifier: %w", err)
		}

		// Any membership row *other* people hold on this Account. A co-member
		// disabled by the invite flow still has one, and the member count
		// ignores it while fk_account_user_account_id does not - so leaving it
		// would fail the DELETE FROM account below. This is the statement the
		// spec's own cascade list omitted.
		if _, err := tx.ExecContext(ctx, "DELETE FROM account_user WHERE account_id = ?;", accountID); err != nil {
			return fmt.Errorf("deleting the account's remaining memberships: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM user WHERE id = ?;", userID); err != nil {
		return fmt.Errorf("deleting the user: %w", err)
	}

	if soleMember {
		if _, err := tx.ExecContext(ctx, "DELETE FROM account WHERE id = ?;", accountID); err != nil {
			return fmt.Errorf("deleting the account: %w", err)
		}
	}

	return nil
}

// DeleteAccount erases a User and, if they are the Account's last member, the
// Account with them. It reports which of those two happened, so a caller can
// tell the user which outcome they got.
//
// **The transaction is this function's guarantee**, which is why it opens one
// rather than accepting one - the spec drafted it as taking a `*sql.Tx`, but a
// cascade that is half-applied is worse than one that has not started, so
// atomicity belongs to the operation rather than to whoever calls it.
//
// The member count is taken inside that transaction, which narrows the window
// in which a co-member could join or leave between the count and the cascade
// but does not close it: MySQL and TiDB default to REPEATABLE READ, where a
// plain SELECT is a non-locking snapshot read and does not block a concurrent
// INSERT into `account_user`. `FOR UPDATE` is used to make the read a locking
// one, so a second deletion of the same Account serialises behind this one.
//
// This is step 5 of the sequence in specs/completed/account-deletion.md - the only
// irreversible one, and deliberately last. The caller is responsible for the
// soft gate and the external systems that precede it. A failure anywhere in
// that sequence leaves a gated, retryable Account rather than a half-deleted
// one, and re-running the whole sequence reaches the same branch here because
// the count ignores the departing user's own row.
func DeleteAccount(ctx context.Context, db *sql.DB, userID string, accountID int, email string) (accountDeleted bool, err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// The caller supplies both ids, so check they belong together before
	// deleting anything. Without this a wrong accountID erases a stranger's
	// Account - and it would take the sole-member branch while doing it, since
	// the departing user has no co-members there. deleteRecipeData is
	// scrupulous about filtering ids through their Account rather than trusting
	// them; this is the same rule one level up.
	//
	// `enabled` is deliberately not filtered: by the time this runs the soft
	// gate has usually disabled the very row being looked for.
	var membership int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM account_user WHERE user_id = ? AND account_id = ?;",
		userID, accountID).Scan(&membership); err != nil {
		return false, fmt.Errorf("checking the user belongs to the account: %w", err)
	}
	if membership == 0 {
		return false, fmt.Errorf("user %q is not a member of account %d", userID, accountID)
	}

	others, err := OtherAccountMembers(ctx, tx, accountID, userID)
	if err != nil {
		return false, err
	}

	// "Sole member" means nobody else is left, counted without reference to the
	// departing user's own row - see OtherAccountMembers for why counting
	// enabled rows and testing for one is a data-loss bug rather than a
	// simplification.
	soleMember := others == 0
	if err := deleteAccountTx(ctx, tx, userID, accountID, HashEmail(email), soleMember); err != nil {
		return false, err
	}

	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("committing the deletion: %w", err)
	}
	// Reported from inside the committed transaction's own decision rather than
	// re-counted afterwards: the rows it was derived from no longer exist, and
	// asking again would be a different question with a different answer.
	return soleMember, nil
}

// AccountAnalyticsID returns the random identifier this Account is known by in
// Google Analytics, minting one the first time it is asked for.
//
// **The identifier exists so that `account.id` is not the same join key across
// Google, Grafana and our own database.** See migrations/036_ga_account_uuid.sql
// for the full argument, and ADR-0008 §1 for why the Auth0 subject never gets
// this far. What it buys is unlinkability rather than deletion: Google keeps
// whatever it already has, and `ga_account_uuid` becomes the only place the link
// between that data and an Account exists - which is what makes deleting the row
// meaningful.
//
// Minted lazily rather than backfilled, so an Account that is never visited
// again never gets an identifier at all.
//
// **A failure here is the caller's to swallow.** This hangs off GET /user, and
// analytics must never be the reason somebody cannot load their recipes - the
// same rule ADR-0007 states for telemetry. GetUser treats an error as "no
// identifier yet", which degrades to no Account being named in Google.
func AccountAnalyticsID(ctx context.Context, db *sql.DB, accountID int) (string, error) {
	var id string
	err := db.QueryRowContext(ctx,
		"SELECT uuid FROM ga_account_uuid WHERE account_id = ?;", accountID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("reading the account's analytics id: %w", err)
	}

	minted := uuid.NewString()
	// INSERT IGNORE, then read back: two concurrent first page loads for the
	// same Account would otherwise race, and the loser must return the value
	// that actually landed rather than the one it generated. Reading back is
	// what makes the identifier stable - a browser that reported one UUID and
	// then another would split one Account across two in Google, which is the
	// failure this table exists to avoid.
	if _, err := db.ExecContext(ctx,
		"INSERT IGNORE INTO ga_account_uuid (account_id, uuid) VALUES (?, ?);", accountID, minted); err != nil {
		return "", fmt.Errorf("minting the account's analytics id: %w", err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT uuid FROM ga_account_uuid WHERE account_id = ?;", accountID).Scan(&id); err != nil {
		return "", fmt.Errorf("reading back the account's analytics id: %w", err)
	}
	return id, nil
}
