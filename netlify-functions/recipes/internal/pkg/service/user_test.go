package service

import (
	"context"
	"strings"
	"testing"

	"recipes/internal/pkg/common"
)

// The insert-only rule is the whole of Phase 1b, and it lives in the shape of
// one SQL statement rather than in any Go control flow - so nothing but a test
// like this can notice it being undone. Someone adding `timezone=?` to the
// UPDATE clause would be making an entirely reasonable-looking edit.
func TestUserUpsertKeepsTimezoneOutOfTheUpdate(t *testing.T) {
	query, _ := userUpsert(common.User{ID: "u1", Name: "A", Email: "a@example.com", Timezone: "Europe/London"})

	insert, update, found := strings.Cut(query, "ON DUPLICATE KEY UPDATE")
	if !found {
		t.Fatalf("statement is no longer an upsert:\n%s", query)
	}
	if !strings.Contains(insert, "timezone") {
		t.Error("timezone is not written on insert, so it would never be captured at all")
	}
	if strings.Contains(update, "timezone") {
		t.Error("timezone appears in the ON DUPLICATE KEY UPDATE clause; a later login would overwrite the zone captured at signup")
	}
	// The columns that are meant to be refreshed on every login still are - so a
	// test that passes by deleting the UPDATE clause entirely does not exist.
	for _, column := range []string{"name", "email", "last_logged_in_at"} {
		if !strings.Contains(update, column) {
			t.Errorf("%s is no longer refreshed on login", column)
		}
	}
}

// Two parameter groups in one statement, so the arguments are ordered
// id, name, email, timezone, then name, email again. Miscounting silently swaps
// a user's name and email rather than failing.
func TestUserUpsertArgumentOrder(t *testing.T) {
	query, args := userUpsert(common.User{
		ID: "u1", Name: "Ada", Email: "ada@example.com", Timezone: "Europe/London",
	})

	if got, want := strings.Count(query, "?"), len(args); got != want {
		t.Fatalf("%d placeholders but %d arguments", got, want)
	}

	want := []any{"u1", "Ada", "ada@example.com", "Europe/London", "Ada", "ada@example.com"}
	if len(args) != len(want) {
		t.Fatalf("got %d arguments, want %d: %v", len(args), len(want), args)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("argument %d = %v, want %v", i, args[i], want[i])
		}
	}
}

// Anything not vouched for becomes NULL rather than failing the insert. This is
// the field a caller could otherwise use to break their own signup: POST /user
// creates the User row and their Account, and pages/index.tsx swallows a
// failure, so a 500 here means somebody simply cannot register.
func TestNormaliseTimezone(t *testing.T) {
	t.Run("keeps a real zone", func(t *testing.T) {
		for _, zone := range []string{"Europe/London", "Asia/Tokyo", "America/Argentina/ComodRivadavia", "UTC"} {
			if got := normaliseTimezone(zone); got != zone {
				t.Errorf("normaliseTimezone(%q) = %v, want it kept", zone, got)
			}
		}
	})

	t.Run("refuses what it cannot vouch for", func(t *testing.T) {
		cases := map[string]string{
			"empty":          "",
			"server's zone":  "Local",
			"not a zone":     "Neptune/Deep_Space",
			"over 64 chars":  strings.Repeat("a", 65),
			"sql injection":  "'; DROP TABLE user; --",
			"exactly 65 num": strings.Repeat("1", 65),
		}
		for name, zone := range cases {
			if got := normaliseTimezone(zone); got != nil {
				t.Errorf("%s: normaliseTimezone(%q) = %v, want nil so the column is NULL", name, zone, got)
			}
		}
	})

	// Guards the embedded tzdata in main.go as much as the function: if the
	// timezone database were unavailable, LoadLocation would fail for every zone
	// and this would return nil for all of them - the exact silent degradation
	// where every user falls back to Europe/London and nothing reports it.
	t.Run("the timezone database is actually available", func(t *testing.T) {
		if normaliseTimezone("Pacific/Auckland") == nil {
			t.Fatal("a valid IANA zone was refused; the timezone database is not loadable in this build")
		}
	})
}

// The collision guard is the only thing standing between a second login
// provider and somebody's recipes disappearing, and all of it is in this one
// predicate - so each clause gets its own assertion, named for what its absence
// would do rather than for the SQL it looks for.
func TestConflictingUserQuery(t *testing.T) {
	q := conflictingUserQuery

	// Both sides lowered, not one. Lowering only the parameter still misses
	// `Ada@Example.com` in the column, which is a wiped account.
	if strings.Count(q, "LOWER(") != 2 {
		t.Errorf("the comparison is not case-insensitive on both sides, so a provider returning a differently-cased address would be treated as a new person:\n%s", q)
	}

	// Without this every returning user matches their own row on every login,
	// and POST /user - which runs on *every* login - starts answering 409 to
	// the entire userbase.
	if !strings.Contains(q, "id != ?") {
		t.Errorf("the query does not exclude the caller's own row, so an existing user would collide with themselves on every login:\n%s", q)
	}

	// The question is "does one exist", and `user.email` carries no unique
	// constraint, so rows predating this guard may already be duplicated.
	if !strings.Contains(q, "LIMIT 1") {
		t.Errorf("the query is not bounded, and user.email has no unique constraint:\n%s", q)
	}
}

// An empty address must not reach the database at all. `user.email` is nullable
// and rows predate it being collected, so `LOWER(email) = LOWER('')` would match
// every one of them and lock a new signup out on somebody else's blank row.
func TestConflictingUserIDIgnoresAnEmptyEmail(t *testing.T) {
	// A nil dbConn is the assertion: reaching the database panics, so this
	// passing means the short-circuit ran.
	existing, err := ConflictingUserID(context.Background(), nil, "", "auth0|new")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if existing != "" {
		t.Errorf("an empty email reported a conflict with %q", existing)
	}
}

// IdentityProvider's output is a span attribute, so the property under test is
// as much "it is never an identifier" as "it names the connection".
func TestIdentityProvider(t *testing.T) {
	cases := map[string]string{
		"google-oauth2|100337785987015262344": "google-oauth2",
		"apple|001234.abcdef":                 "apple",
		"windowslive|1a2b3c":                  "windowslive",
		"auth0|65f0c0ffee":                    "auth0",
		// No separator: the whole string could be anything, including something
		// that identifies a person, so it must not be echoed onto a span.
		"local-dev-user": "unknown",
		"":               "unknown",
		// A leading separator would make the prefix empty, which is not a
		// connection name either.
		"|nothing": "unknown",
	}
	for subject, want := range cases {
		if got := IdentityProvider(subject); got != want {
			t.Errorf("IdentityProvider(%q) = %q, want %q", subject, got, want)
		}
	}
}
