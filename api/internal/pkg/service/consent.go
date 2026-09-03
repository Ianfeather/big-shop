package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"recipes/internal/pkg/common"
)

// The analytics-consent record. See migrations/034_consent_event.sql for why
// the table is append-only and why it carries no IP address.

// ConsentSource is how a decision was given - the "how" half of what a consent
// record has to carry.
type ConsentSource string

const (
	// ConsentSourceBanner is the cookie banner on first visit.
	ConsentSourceBanner ConsentSource = "banner"
	// ConsentSourceSettings is the "Cookie settings" control, i.e. a decision
	// changed after the first one.
	ConsentSourceSettings ConsentSource = "settings"
	// ConsentSourceLoginSync is a decision taken while logged out and carried in
	// on the first authenticated load. `created_at` for these is when we learned
	// the answer, not when it was given.
	ConsentSourceLoginSync ConsentSource = "login-sync"
)

// Valid reports whether s is one of the three the column's ENUM accepts.
//
// Checked in Go rather than left to MySQL because an out-of-range ENUM value is
// one of the places MySQL's default behaviour is actively unhelpful: outside
// strict mode it inserts the empty string and warns, so a typo would be
// recorded as a consent decision with no source at all rather than rejected.
func (s ConsentSource) Valid() bool {
	switch s {
	case ConsentSourceBanner, ConsentSourceSettings, ConsentSourceLoginSync:
		return true
	}
	return false
}

// RecordConsent appends a decision. It never updates: see the migration.
//
// Takes the narrow `execer` rather than *sql.DB - the same interface
// insertIngredients and friends use - so a test can assert the statement it
// issues without a database. That is not a convenience here: "append-only" is
// the property the whole table exists for, and until this was testable it was
// guaranteed by nothing but the absence of an UPDATE.
func RecordConsent(ctx context.Context, db execer, userID string, analytics bool, policyVersion string, source ConsentSource) error {
	query := `INSERT INTO consent_event (user_id, analytics, policy_version, source) VALUES (?, ?, ?, ?)`
	if _, err := db.ExecContext(ctx, query, userID, analytics, policyVersion, string(source)); err != nil {
		return fmt.Errorf("recording consent: %w", err)
	}
	return nil
}

// GetLatestConsent returns the most recent decision for a user, or nil if they
// have never made one.
//
// Nil rather than a false-y zero value, and the distinction is the same one the
// browser store draws between `denied` and `unset`: "they said no" and "we have
// never asked" are different facts, and only the first of them is a decision.
// Collapsing them here would make the client re-ask someone who had declined.
//
// Ordered by id rather than created_at. Both are monotonic, but created_at is a
// datetime with second resolution and these rows are written in bursts - a
// decision made and immediately changed in the same second would otherwise tie,
// and the tie-break would be whatever order the storage engine felt like.
func GetLatestConsent(ctx context.Context, db *sql.DB, userID string) (*common.Consent, error) {
	query := `
		SELECT analytics, policy_version, created_at
			FROM consent_event
			WHERE user_id = ?
			ORDER BY id DESC
			LIMIT 1
	`

	consent := &common.Consent{}
	var decidedAt time.Time
	err := db.QueryRowContext(ctx, query, userID).Scan(&consent.Analytics, &consent.PolicyVersion, &decidedAt)
	if errors.Is(err, sql.ErrNoRows) {
		// Not an error: most users have never been asked at this point, and a
		// caller cannot tell "no decision" from a failed query if this returns
		// one. The unwrapped nil,nil is the honest answer.
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getting latest consent: %w", err)
	}
	// RFC 3339 in UTC, so the client can compare it against its own timestamp
	// without parsing a MySQL datetime or guessing a zone.
	consent.DecidedAt = decidedAt.UTC().Format(time.RFC3339)
	return consent, nil
}
