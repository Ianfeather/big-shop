package service

import (
	"context"
	"strings"
	"testing"
)

// The append-only guarantee, asserted rather than assumed.
//
// migrations/034_consent_event.sql calls this "the whole point" of the table:
// a record that can be overwritten proves nothing about a consent that has
// since been withdrawn. Before this test the property was guaranteed only by
// the absence of an UPDATE in a file nobody was watching, which is exactly the
// kind of invariant that survives until the first person who finds an INSERT
// wasteful.
func TestRecordConsentOnlyEverAppends(t *testing.T) {
	fake := &fakeExecer{}

	if err := RecordConsent(context.Background(), fake, "auth0|abc", true, "2026-08-16", ConsentSourceBanner); err != nil {
		t.Fatalf("RecordConsent: %v", err)
	}

	if len(fake.queries) != 1 {
		t.Fatalf("expected exactly one statement, got %d: %v", len(fake.queries), fake.queries)
	}

	query := fake.queries[0]
	if !strings.Contains(query, "INSERT INTO consent_event") {
		t.Errorf("expected an INSERT into consent_event, got: %s", query)
	}
	for _, forbidden := range []string{"UPDATE", "DELETE", "REPLACE", "ON DUPLICATE KEY"} {
		if strings.Contains(strings.ToUpper(query), forbidden) {
			t.Errorf("consent must never %s - the record is append-only. Query: %s", forbidden, query)
		}
	}
}

// Changing a decision has to be a second row, not an edit of the first.
func TestChangingConsentAppendsAgain(t *testing.T) {
	fake := &fakeExecer{}
	ctx := context.Background()

	if err := RecordConsent(ctx, fake, "auth0|abc", true, "2026-08-16", ConsentSourceBanner); err != nil {
		t.Fatalf("RecordConsent: %v", err)
	}
	if err := RecordConsent(ctx, fake, "auth0|abc", false, "2026-08-16", ConsentSourceSettings); err != nil {
		t.Fatalf("RecordConsent: %v", err)
	}

	if len(fake.queries) != 2 {
		t.Fatalf("expected two statements, got %d: %v", len(fake.queries), fake.queries)
	}
	for i, q := range fake.queries {
		if !strings.Contains(q, "INSERT INTO consent_event") {
			t.Errorf("statement %d should be an INSERT, got: %s", i, q)
		}
	}
}

func TestConsentSourceValid(t *testing.T) {
	for _, source := range []ConsentSource{ConsentSourceBanner, ConsentSourceSettings, ConsentSourceLoginSync} {
		if !source.Valid() {
			t.Errorf("%q should be valid", source)
		}
	}

	// The reason this check exists in Go at all: outside strict mode MySQL
	// stores an out-of-range ENUM as the empty string and merely warns, so a
	// bad value would be recorded as a consent decision with no source rather
	// than rejected.
	for _, source := range []ConsentSource{"", "Banner", "carrier-pigeon"} {
		if source.Valid() {
			t.Errorf("%q should not be valid", source)
		}
	}
}
