package lifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// loadCandidates reads everyone the sequence could possibly apply to.
//
// Deliberately not a "who is due right now" query. The spec sketches the due
// test in SQL, and it could be written that way, but the local-hour and
// day-counting arithmetic would then have to happen in MySQL - which means
// CONVERT_TZ, which silently returns NULL unless the server's timezone tables
// have been populated, a step nobody has run on TiDB or in the e2e container.
// The failure mode is a query that runs perfectly and matches nobody, forever.
// So the filtering that is cheap and safe in SQL happens here, and everything
// involving a clock happens in due(), where it is a pure function with tests.
//
// At tens of users this reads the whole table hourly, which is nothing. If it
// ever stops being nothing, the fix is a created_at index and a ceiling on how
// far back to look - not moving the arithmetic into SQL.
//
// Three filters that are genuinely SQL's job:
//
//   - **created_at >= email_launch.launched_at.** The sequence reaches new
//     signups only. A "Welcome to Big Shop!" landing on somebody who joined
//     eight months ago reads as broken, and long-dormant addresses are the
//     likeliest to mark a first send as spam - which poisons the suppression
//     list permanently, on a sending domain with no reputation yet to spend.
//     The INNER JOIN is load-bearing: no launch row means no candidates at all,
//     which is the right answer if this migration somehow has not run.
//
//   - **A non-empty email.** Nobody has ever checked how complete or accurate
//     that column is, and specs/completed/email.md does not assume it is: a null or
//     malformed address is a skip, not an error.
//
//   - **Everything already sent**, gathered in the same pass, so due() can see
//     the whole picture for a user rather than asking per kind.
func loadCandidates(ctx context.Context, db *sql.DB) ([]Candidate, error) {
	const query = `
		SELECT u.id, u.email, u.name, u.timezone, u.created_at, e.kind, e.sent_at
			FROM user u
			JOIN email_launch l ON l.id = 1
			LEFT JOIN email_send e ON e.user_id = u.id
			WHERE u.created_at >= l.launched_at
				AND u.email IS NOT NULL
				AND u.email <> ''
			ORDER BY u.id
	`

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("loading email candidates: %w", err)
	}
	defer rows.Close()

	// One row per (user, sent kind), so a user with two sends appears twice and
	// a user with none appears once with a NULL kind. Folded back into one
	// Candidate each, in id order.
	var candidates []Candidate
	byID := map[string]int{}

	for rows.Next() {
		var (
			id, email string
			name      sql.NullString
			timezone  sql.NullString
			createdAt time.Time
			kind      sql.NullString
			sentAt    sql.NullTime
		)
		if err := rows.Scan(&id, &email, &name, &timezone, &createdAt, &kind, &sentAt); err != nil {
			return nil, fmt.Errorf("scanning email candidate: %w", err)
		}

		index, seen := byID[id]
		if !seen {
			candidates = append(candidates, Candidate{
				UserID:    id,
				Email:     email,
				Name:      name.String,
				Timezone:  timezone.String,
				CreatedAt: createdAt,
				Sent:      map[Kind]bool{},
			})
			index = len(candidates) - 1
			byID[id] = index
		}
		if kind.Valid {
			candidates[index].Sent[Kind(kind.String)] = true
		}
		// The latest send across all kinds, which is what due()'s one-per-day
		// guard needs. Accumulated here rather than with a MAX() in SQL because
		// the rows are already being folded per user.
		if sentAt.Valid && sentAt.Time.After(candidates[index].LastSentAt) {
			candidates[index].LastSentAt = sentAt.Time
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading email candidates: %w", err)
	}

	return candidates, nil
}

// RecordSend writes the email_send row that stops this email ever being sent to
// this user again.
//
// **Called only after a send actually succeeded.** That is half of what makes
// the sequence self-heal - the other half being due()'s `>=` - and it is the
// reason a failed send, an outage, or a deploy during the send hour costs a day
// rather than losing an email entirely.
//
// The composite primary key on (user_id, kind) is the idempotency guarantee
// itself: a duplicate is a key violation rather than a second email in
// somebody's inbox. That is what makes the ticker safe to re-run by hand, and
// what would catch a second machine if Fly ever scaled past one.
//
// Exported because Phase 1d gives the welcome email an inline send on signup, in
// addition to the ticker's, and it has to record itself the same way. Until then
// the ticker is the only caller and welcome is simply Day 0 in the Sequence.
//
// **sentAt is supplied rather than left to the column's DEFAULT
// CURRENT_TIMESTAMP**, which is what it used to be. The value is read back by
// due()'s one-per-day guard and compared against a time this process produced,
// so the two have to come from the same clock. MySQL's CURRENT_TIMESTAMP is
// evaluated in the *database server's* timezone while the driver parses
// datetimes back as UTC, so a database not running in UTC would return a
// sent_at skewed by its offset - enough, at the wrong offset, to put a send on
// the wrong side of a local midnight and defeat the guard it exists to feed.
// Passing the instant removes the question rather than relying on a
// configuration nobody here controls.
// ClaimSend reserves (user, kind) before an email is sent, reporting whether
// this caller got the claim.
//
// Used by the inline welcome send, where "write the row only on success" is not
// safe on its own. Both send paths would otherwise send first and record second,
// which means email_send's primary key protects the *log* and not the *inbox*:
// two paths can each see no row, each send, and only the second insert fail.
// Claiming first makes the key do the job it is described as doing - whoever
// inserts first sends, and the loser does not.
//
// A duplicate key is a normal answer, not an error: it means somebody else got
// there first. Any other error is real and is returned.
func ClaimSend(ctx context.Context, db *sql.DB, userID string, kind Kind, at time.Time) (bool, error) {
	const query = `INSERT IGNORE INTO email_send (user_id, kind, sent_at) VALUES (?, ?, ?)`
	result, err := db.ExecContext(ctx, query, userID, string(kind), at.UTC())
	if err != nil {
		return false, fmt.Errorf("claiming %s email for %s: %w", kind, userID, err)
	}
	// INSERT IGNORE affects one row when it inserted and none when the key
	// already existed, which is exactly the question being asked. Preferred over
	// catching a driver-specific duplicate-key error number.
	affected, err := result.RowsAffected()
	if err != nil {
		// Cannot tell whether the claim was ours. Reporting "not claimed" means
		// no email rather than a possible duplicate, and the ticker picks it up
		// tomorrow.
		return false, nil
	}
	return affected == 1, nil
}

// ReleaseSend gives a claim back when the send it was taken for failed.
//
// Without it a failed send would leave a row saying the email went out, and the
// ticker - which skips anything already in email_send - would never retry it.
// The email would be lost silently, which is the failure this whole design is
// built to avoid.
//
// If the process dies between claiming and releasing, the claim survives and
// that one welcome email is never sent. That is a real gap, accepted knowingly:
// it needs a crash inside a window of seconds, and losing one welcome is a much
// smaller harm than sending two.
func ReleaseSend(ctx context.Context, db *sql.DB, userID string, kind Kind) error {
	const query = `DELETE FROM email_send WHERE user_id = ? AND kind = ?`
	if _, err := db.ExecContext(ctx, query, userID, string(kind)); err != nil {
		return fmt.Errorf("releasing %s claim for %s: %w", kind, userID, err)
	}
	return nil
}

func RecordSend(ctx context.Context, db *sql.DB, userID string, kind Kind, sentAt time.Time) error {
	const query = `INSERT INTO email_send (user_id, kind, sent_at) VALUES (?, ?, ?)`
	if _, err := db.ExecContext(ctx, query, userID, string(kind), sentAt.UTC()); err != nil {
		return fmt.Errorf("recording %s email for %s: %w", kind, userID, err)
	}
	return nil
}
