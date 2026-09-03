package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/telemetry"
	"strings"
	"time"
)

// HashEmail is the one place `invite.email`'s digest is computed.
//
// **The invite table used to be the app's largest privacy exposure, and the
// least obvious.** `service/invite.go` deletes a row on accept and on reject,
// and nothing deleted it on expiry - `GetInvites` merely filtered
// `expires > ?`. So every address ever typed into the invite box was still in
// the database, indefinitely, including addresses of people who never signed
// up, never consented, and have no Account to delete.
//
// Storing a digest works here and would not work for `user.email`, because of
// how the column is used: every read of `invite.email` is an equality match
// against the caller's own address, and the plaintext is never read back out.
// Hashing therefore breaks no existing path.
//
// **Peppered, not a plain SHA-256.** The email address space is enumerable, so
// a plain digest would let anyone holding a database dump confirm whether a
// specific named person had been invited by hashing their address and grepping
// for it. The pepper is a deployment secret (`INVITE_EMAIL_PEPPER`, a Fly
// secret in production), which turns that offline check into one that needs the
// secret too.
//
// It defaults to empty in dev, e2e and CI, which degrades to an unpeppered
// digest - deterministically, and per environment. That is the right trade for a
// local stack with no real addresses in it, and it means no test needs a secret.
//
// "Unpeppered" rather than "a plain SHA-256", which this comment used to say and
// which is wrong in a way that costs an hour if you believe it: an empty HMAC key
// is not the same thing as no HMAC, so HashEmail("x") with no pepper is
// HMAC-SHA256(key="", "x"), not SHA256("x"). Anyone reproducing a digest by hand -
// to seed a fixture, or to check a row - has to use HMAC either way. It makes no
// difference to the security argument, since an empty key is as computable by an
// attacker as no key at all.
//
// Read from the environment on each call rather than captured once, following
// `SENDGRID_API_KEY`'s precedent in app/user.go - the process is long-lived on
// Fly, and a captured value would need a redeploy to rotate.
//
// The address is lowercased and trimmed first so that "  Bob@Example.com " and
// "bob@example.com" produce one digest. Without it the same person could hold
// two invite rows and match neither reliably, since the primary key is
// (account, email).
func HashEmail(email string) string {
	mac := hmac.New(sha256.New, []byte(os.Getenv("INVITE_EMAIL_PEPPER")))
	mac.Write([]byte(strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(mac.Sum(nil))
}

// purgeExpiredInvites deletes invites that are past their expiry.
//
// **Lazily, on two paths that already write or read the table**, because there
// is no scheduler anywhere in this architecture and inventing one for a single
// DELETE is disproportionate. `GetInvites` runs on every account-page load, so
// the purge stays timely in practice; the table is tiny, so a write on a read
// path is noise.
//
// A consequence worth naming: the table is never more than ~30 days deep, so a
// pepper rotation self-heals within a month rather than being a one-way door.
//
// Failure is recorded and swallowed. This is housekeeping - a caller trying to
// list or create an invite should not fail because an unrelated expired row
// could not be cleaned up.
func purgeExpiredInvites(ctx context.Context, db execer) {
	if _, err := db.ExecContext(ctx, "DELETE FROM invite WHERE expires <= ?;", time.Now()); err != nil {
		telemetry.RecordWarning(ctx, "purge expired invites", err)
	}
}

func CreateInvite(ctx context.Context, db *sql.DB, token string, accountID int, email string, userID string) error {
	purgeExpiredInvites(ctx, db)

	inviteQuery := `
		INSERT INTO invite (token, account, email, admin_id, expires)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE email=email;
	`

	_, err := db.ExecContext(ctx, inviteQuery, token, accountID, HashEmail(email), userID, time.Now().AddDate(0, 0, 30))
	if err != nil {
		return fmt.Errorf("adding invite: %w", err)
	}
	return nil
}

func GetInvites(ctx context.Context, db *sql.DB, email string) (i []common.Invite, e error) {
	purgeExpiredInvites(ctx, db)

	query := `
		SELECT token, name
			FROM invite
			LEFT JOIN user on user.id = invite.admin_id
			WHERE invite.email = ? AND invite.expires > ?;`

	results, err := db.QueryContext(ctx, query, HashEmail(email), time.Now())

	if err != nil {
		return nil, fmt.Errorf("querying invites: %w", err)
	}
	defer results.Close()

	invites := make([]common.Invite, 0)

	for results.Next() {
		invite := common.Invite{}
		err = results.Scan(&invite.Token, &invite.AccountHolder)
		if err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return invites, nil

}

// Invitation is one invite row, resolved for a caller who has proved it is
// addressed to them.
//
// AdminID is the User who sent it. Returned alongside the account rather than
// left to a second query because both callers need it: accepting and rejecting
// each notify the inviter, and neither has any other handle on who that is.
type Invitation struct {
	AccountID int
	AdminID   string
}

// GetInvite resolves an invite by token, **scoped to the address it was sent
// to**.
//
// The email is half the lookup, not a courtesy check. A token alone identifies
// a row, so matching on the token by itself would let anybody holding one act
// on an invitation addressed to somebody else. Both callers pass the caller's
// own address, so a mismatched pair resolves to no rows and the handler fails.
func GetInvite(ctx context.Context, db *sql.DB, token string, email string) (*Invitation, error) {
	var invitation Invitation
	inviteQuery := `SELECT account, admin_id from invite WHERE email = ? and token = ?;`
	if err := db.QueryRowContext(ctx, inviteQuery, HashEmail(email), token).
		Scan(&invitation.AccountID, &invitation.AdminID); err != nil {
		return nil, fmt.Errorf("querying invite: %w", err)
	}
	return &invitation, nil
}

func DeleteInvite(ctx context.Context, db *sql.DB, accountID int, email string) error {
	inviteQuery := `DELETE from invite WHERE account = ? and email = ?;`
	_, err := db.ExecContext(ctx, inviteQuery, accountID, HashEmail(email))
	if err != nil {
		return fmt.Errorf("deleting invite: %w", err)
	}
	return nil
}

// looksHashed reports whether a stored value is already a digest rather than a
// plaintext address.
//
// A 64-character hex string is unambiguous here: HashEmail always produces
// exactly that, and no email address can be one, because every address contains
// an "@" and hex contains no "@". So this needs no marker column and no
// migration flag to tell the two apart.
func looksHashed(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// plaintextInvite is one row still holding an address rather than a digest.
type plaintextInvite struct {
	account int
	email   string
}

// hashInvites rewrites each given row's address as a peppered digest. It
// reports how many rows it attempted, and how many rows the sweep removed for
// still holding a plaintext address afterwards.
//
// Those two numbers are reported rather than a single "hashed" count because a
// single count cannot be derived honestly: the sweep is table-wide, so it also
// removes a straggler left by a previous interrupted run, and subtracting it
// from the batch size can go negative. Saying what each number actually counts
// is worth more to whoever runs this than a tidier-looking one that is
// sometimes a lie.
//
// Split out from HashExistingInviteEmails, and taking `execer` rather than
// *sql.DB, so that the part with the actual reasoning in it can be tested
// against a fake - the same seam purgeExpiredInvites has. Reading the rows
// needs a real database; deciding what to do with them does not.
//
// **The UPDATE's RowsAffected is never consulted, deliberately.** The obvious
// shape is `UPDATE IGNORE` plus "0 rows affected means a duplicate was
// suppressed", and it is wrong twice over: MySQL's UPDATE counts *changed*
// rows, so 0 also means "the value was already that" and "the row is gone" -
// and whether it counts changed or matched rows depends on the DSN's
// `clientFoundRows` flag, which is a production secret this code should not
// have an opinion about. The sweep's DELETE count is used instead, which has no
// such ambiguity: a DELETE affects the rows it removed and nothing else.
func hashInvites(ctx context.Context, db execer, pending []plaintextInvite) (attempted int, removed int, err error) {
	for _, i := range pending {
		// IGNORE because the primary key is (account, email), so hashing can
		// collide: two rows whose addresses differed only by case or by
		// surrounding whitespace normalise to one digest. The collision is
		// left in place here and swept below rather than being untangled
		// row-by-row.
		if _, err := db.ExecContext(ctx,
			"UPDATE IGNORE invite SET email = ? WHERE account = ? AND email = ?;",
			HashEmail(i.email), i.account, i.email); err != nil {
			return 0, 0, fmt.Errorf("hashing invite for account %d: %w", i.account, err)
		}
	}

	// Whatever is still plaintext at this point lost a collision above: its
	// digest twin is already in the table, so the invite is still represented
	// and this row is redundant. One set-based sweep, which is both simpler
	// than per-row bookkeeping and independent of any driver semantics.
	//
	// The loser's emailed token dies with it. That is recoverable rather than
	// lost: an invitee never needs the emailed link, because /account lists
	// their invites and returns the surviving row's token.
	//
	// Safe against a live API writing concurrently: anything CreateInvite has
	// inserted since this build deployed is already a digest, so it cannot
	// match.
	res, err := db.ExecContext(ctx, "DELETE FROM invite WHERE email NOT REGEXP ?;", hexDigestPattern)
	if err != nil {
		return 0, 0, fmt.Errorf("removing invites left duplicated by hashing: %w", err)
	}
	swept, err := res.RowsAffected()
	if err != nil {
		return 0, 0, fmt.Errorf("counting invites removed as duplicates: %w", err)
	}

	return len(pending), int(swept), nil
}

// hexDigestPattern matches exactly what HashEmail produces, and is the SQL-side
// counterpart of looksHashed.
const hexDigestPattern = "^[0-9a-f]{64}$"

// HashExistingInviteEmails converts any plaintext address still sitting in
// `invite.email` into a peppered digest, and reports how many rows it found to
// convert.
//
// This is the backfill for migrations/035_invite_email_hash.sql, and it lives
// here rather than in the migration because **MySQL 8 has SHA2() but no HMAC**,
// and a plain SHA-256 is exactly what that migration's header rejects. Running
// it through the same HashEmail the read path uses is also the only way to
// guarantee the backfill and the reads cannot drift apart.
//
// Idempotent: a value that already looks like a digest is never selected, so
// running it twice is harmless, and running it before or after the migration
// makes no difference (the migration only changes a column comment).
//
// **Set INVITE_EMAIL_PEPPER before running this.** Against an empty pepper it
// produces plain digests that the peppered read path will never match, which
// silently orphans every live invite.
//
// It verifies its own work before returning, because a subcommand - unlike a
// migration - does not run itself, and "no plaintext address remains in
// `invite`" is the condition the whole change is judged on. A non-zero count
// here is a failure, not a warning.
func HashExistingInviteEmails(ctx context.Context, db *sql.DB) (int, error) {
	// Expired rows would be deleted by the next GetInvites anyway, so hashing
	// them first is work done to no end.
	purgeExpiredInvites(ctx, db)

	rows, err := db.QueryContext(ctx, "SELECT account, email FROM invite WHERE email NOT REGEXP ?;", hexDigestPattern)
	if err != nil {
		return 0, fmt.Errorf("reading invites to hash: %w", err)
	}

	var pending []plaintextInvite
	for rows.Next() {
		var i plaintextInvite
		if err := rows.Scan(&i.account, &i.email); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scanning invite row: %w", err)
		}
		pending = append(pending, i)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("reading invites to hash: %w", err)
	}
	// Closed before the writes rather than deferred: they run on the same pool,
	// and holding the read's connection open across them is an easy way to
	// exhaust a small one.
	rows.Close()

	attempted, removed, err := hashInvites(ctx, db, pending)
	if err != nil {
		return 0, err
	}
	if removed > 0 {
		// Worth saying out loud rather than burying: these were separate invite
		// rows before this ran, and they are not afterwards.
		telemetry.RecordWarning(ctx, "invites removed as duplicates by hashing",
			fmt.Errorf("%d invite row(s) collided with another address that normalises to the same digest", removed))
	}

	var remaining int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM invite WHERE email NOT REGEXP ?;", hexDigestPattern).Scan(&remaining); err != nil {
		return attempted, fmt.Errorf("verifying no plaintext invite addresses remain: %w", err)
	}
	if remaining != 0 {
		return attempted, fmt.Errorf("%d invite row(s) still hold a plaintext address after hashing", remaining)
	}

	return attempted, nil
}
