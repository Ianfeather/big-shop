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
	caller := NewCaller("auth0|someone", func() (int, error) {
		calls++
		return 42, nil
	})

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
	caller := NewCaller("auth0|someone", func() (int, error) {
		calls++
		return 42, nil
	})

	if caller.UserID != "auth0|someone" {
		t.Errorf("UserID = %q", caller.UserID)
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
	caller := NewCaller("auth0|nobody", func() (int, error) {
		calls++
		return 0, sql.ErrNoRows
	})

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
	caller := NewCaller("auth0|someone", func() (int, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		return 7, nil
	})

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
