package common

import (
	"database/sql"
	"errors"
	"sync"
	"testing"
)

// The point of the type: nine lookups become one.
func TestAccountIDResolvesOnce(t *testing.T) {
	calls := 0
	caller := NewCaller("auth0|someone", "", func() (string, int, error) {
		calls++
		return "u1", 42, nil
	}, noAdmin)

	for i := 0; i < 9; i++ {
		id, err := caller.AccountID()
		if err != nil {
			t.Fatalf("AccountID() error = %v", err)
		}
		if id != 42 {
			t.Errorf("AccountID() = %d, want 42", id)
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1", calls)
	}
}

// Nothing resolves an Account until something asks for one. This is what keeps
// GET /tags, /units, /ingredients, /user and /invites at zero account lookups -
// resolving eagerly in middleware would add a query to all five.
func TestAccountIDIsNotResolvedUntilAsked(t *testing.T) {
	calls := 0
	caller := NewCaller("auth0|someone", "", func() (string, int, error) {
		calls++
		return "u1", 42, nil
	}, noAdmin)

	// Subject, not UserID(): reading the resolved person is now itself a
	// lookup, so asserting on it here would resolve the very thing this test
	// says must not be resolved yet.
	if caller.Subject != "auth0|someone" {
		t.Errorf("Subject = %q", caller.Subject)
	}
	if calls != 0 {
		t.Errorf("resolved %d times before being asked, want 0", calls)
	}
}

// The error is memoised as deliberately as the value, and it is returned
// unwrapped: a user with no account_user row surfaces sql.ErrNoRows, which is
// what handlers have always turned into a 500. Resolving lazily must not
// change that.
func TestAccountIDMemoisesTheError(t *testing.T) {
	calls := 0
	caller := NewCaller("auth0|nobody", "", func() (string, int, error) {
		calls++
		return "", 0, sql.ErrNoRows
	}, noAdmin)

	for i := 0; i < 3; i++ {
		id, err := caller.AccountID()
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("AccountID() error = %v, want sql.ErrNoRows", err)
		}
		if id != 0 {
			t.Errorf("AccountID() = %d, want 0 alongside an error", id)
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1 - a failure must not be retried per call", calls)
	}
}

// A Caller belongs to one request, but a single request can fan out (Phase 6b
// intends exactly that), so concurrent first-use must still resolve once.
func TestAccountIDIsSafeUnderConcurrentFirstUse(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	caller := NewCaller("auth0|someone", "", func() (string, int, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		return "u1", 7, nil
	}, noAdmin)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if id, err := caller.AccountID(); id != 7 || err != nil {
				t.Errorf("AccountID() = %d, %v", id, err)
			}
		}()
	}
	wg.Wait()

	if calls != 1 {
		t.Errorf("resolved %d times under concurrency, want 1", calls)
	}
}

// noAdmin is the admin resolver for tests that are not about admin at all -
// which is all of the ones above. Its presence is the point: NewCaller now
// takes two resolvers, and every one of these tests is asserting something
// about the *first* being called exactly once and not before it is needed.
func noAdmin() (bool, error) { return false, nil }

// IsAdmin resolves lazily and memoises, for the same reason AccountID does:
// two write paths ask, and every other route in the API does not.
func TestIsAdminResolvesOnceAndNotUntilAsked(t *testing.T) {
	calls := 0
	caller := NewCaller("auth0|someone", "", func() (string, int, error) {
		return "u1", 42, nil
	}, func() (bool, error) {
		calls++
		return true, nil
	})

	if calls != 0 {
		t.Fatalf("resolved before being asked (%d calls)", calls)
	}

	for i := 0; i < 5; i++ {
		admin, err := caller.IsAdmin()
		if err != nil {
			t.Fatalf("IsAdmin() error = %v", err)
		}
		if !admin {
			t.Error("IsAdmin() = false, want true")
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1", calls)
	}
}

// The error is memoised as deliberately as the value - the same reasoning as
// AccountID's, and the same failure if it were not: a second caller within one
// request would re-run a lookup that has already failed.
func TestIsAdminMemoisesItsError(t *testing.T) {
	calls := 0
	boom := errors.New("boom")
	caller := NewCaller("auth0|someone", "", func() (string, int, error) {
		return "u1", 42, nil
	}, func() (bool, error) {
		calls++
		return false, boom
	})

	for i := 0; i < 3; i++ {
		if _, err := caller.IsAdmin(); !errors.Is(err, boom) {
			t.Fatalf("IsAdmin() error = %v, want %v", err, boom)
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1", calls)
	}
}

// UserID and AccountID come out of one resolution, not two.
//
// This is the property that made it reasonable to turn UserID from a field into
// a query at all: aliasing meant "who is this" stopped being a fact carried in
// the token, and answering it separately would have doubled the lookups this
// type exists to collapse. Reading both must still cost one.
func TestUserIDAndAccountIDShareOneResolution(t *testing.T) {
	calls := 0
	caller := NewCaller("google-oauth2|123", "", func() (string, int, error) {
		calls++
		return "google-oauth2|123", 42, nil
	}, noAdmin)

	for i := 0; i < 5; i++ {
		if _, err := caller.UserID(); err != nil {
			t.Fatalf("UserID() error = %v", err)
		}
		if _, err := caller.AccountID(); err != nil {
			t.Fatalf("AccountID() error = %v", err)
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1", calls)
	}
}

// The person and the subject are allowed to differ, and everything downstream
// must get the person.
//
// This is the whole of the multi-provider design in one assertion: somebody
// signing in through their second provider arrives with a subject nothing else
// has ever seen, and resolves to the `user.id` that owns their recipes.
func TestUserIDIsThePersonNotTheSubject(t *testing.T) {
	caller := NewCaller("windowslive|second-login", "", func() (string, int, error) {
		return "google-oauth2|the-original", 42, nil
	}, noAdmin)

	userID, err := caller.UserID()
	if err != nil {
		t.Fatalf("UserID() error = %v", err)
	}
	if userID != "google-oauth2|the-original" {
		t.Errorf("UserID() = %q, want the person the subject aliases to", userID)
	}
	// Still available, and still the login rather than the person - telemetry
	// joins on it back to an Auth0 log entry.
	if caller.Subject != "windowslive|second-login" {
		t.Errorf("Subject = %q, want the subject that actually authenticated", caller.Subject)
	}
}

// A subject nobody has seen resolves to nothing, and the error is memoised like
// any other. It must not fall back to the subject: that fallback is the bug the
// alias table exists to prevent, where an unrecognised login quietly became a
// new person with a new empty Account.
func TestUserIDMemoisesTheUnknownSubjectError(t *testing.T) {
	calls := 0
	unknown := errors.New("no user is known for this auth0 subject")
	caller := NewCaller("apple|stranger", "", func() (string, int, error) {
		calls++
		return "", 0, unknown
	}, noAdmin)

	for i := 0; i < 3; i++ {
		id, err := caller.UserID()
		if !errors.Is(err, unknown) {
			t.Fatalf("UserID() error = %v, want %v", err, unknown)
		}
		if id != "" {
			t.Errorf("UserID() = %q, want empty rather than a fallback to the subject", id)
		}
	}

	if calls != 1 {
		t.Errorf("resolved %d times, want 1", calls)
	}
}
