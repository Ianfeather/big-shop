package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// clearAuth0Env removes every Management credential, so a test starts from the
// state dev, e2e and CI are actually in.
func clearAuth0Env(t *testing.T) {
	t.Helper()
	t.Setenv("AUTH0_DOMAIN", "")
	t.Setenv("AUTH0_TENANT_DOMAIN", "")
	t.Setenv("AUTH0_MGMT_CLIENT_ID", "")
	t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "")
	t.Setenv("SENDGRID_API_KEY", "")
}

func TestEraseSendGridRecipient(t *testing.T) {
	t.Run("no API key is a clean skip, not an error", func(t *testing.T) {
		// SENDGRID_API_KEY is unset everywhere today - board item #46 is what
		// sets it - so this is the live path, and it must not make deletion
		// report a failure.
		clearAuth0Env(t)
		called, err := EraseSendGridRecipient(context.Background(), "bob@example.com")
		if err != nil {
			t.Fatalf("expected a clean skip, got %v", err)
		}
		if called {
			t.Error("reported a call with no API key configured")
		}
	})

	t.Run("sends a DELETE naming the address, with the key", func(t *testing.T) {
		clearAuth0Env(t)
		t.Setenv("SENDGRID_API_KEY", "SG.a-key")

		var gotMethod, gotAuth, gotPath string
		var gotBody map[string][]string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotAuth, gotPath = r.Method, r.Header.Get("Authorization"), r.URL.Path
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &gotBody)
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()
		sendGridBaseURL = srv.URL
		defer func() { sendGridBaseURL = "https://api.sendgrid.com" }()

		called, err := EraseSendGridRecipient(context.Background(), "bob@example.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !called {
			t.Error("did not report the call it made")
		}
		if gotMethod != http.MethodDelete {
			t.Errorf("method = %s, want DELETE", gotMethod)
		}
		if gotPath != "/v3/recipients/erasejob" {
			t.Errorf("path = %s", gotPath)
		}
		if gotAuth != "Bearer SG.a-key" {
			t.Errorf("authorization = %q", gotAuth)
		}
		if len(gotBody["emails"]) != 1 || gotBody["emails"][0] != "bob@example.com" {
			t.Errorf("body = %v, want the one address", gotBody)
		}
	})

	t.Run("a failure is reported so the caller can log and continue", func(t *testing.T) {
		clearAuth0Env(t)
		t.Setenv("SENDGRID_API_KEY", "SG.a-key")
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		sendGridBaseURL = srv.URL
		defer func() { sendGridBaseURL = "https://api.sendgrid.com" }()

		if _, err := EraseSendGridRecipient(context.Background(), "bob@example.com"); err == nil {
			t.Fatal("expected an error")
		}
	})
}

func TestDeleteAuth0User(t *testing.T) {
	t.Run("no management credentials means a skip", func(t *testing.T) {
		// The owner's decision, 2026-08-19. It is also what makes deletion work
		// at all in dev, e2e and CI, where there is no reachable tenant.
		clearAuth0Env(t)
		called, err := DeleteAuth0User(context.Background(), "auth0|123")
		if err != nil {
			t.Fatalf("expected a clean skip, got %v", err)
		}
		if called {
			t.Error("reported a call with no credentials configured")
		}
	})

	t.Run("partial credentials also skip rather than half-calling", func(t *testing.T) {
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "id-only")
		// No secret.
		called, err := DeleteAuth0User(context.Background(), "auth0|123")
		if err != nil {
			t.Fatalf("expected a clean skip, got %v", err)
		}
		if called {
			t.Error("attempted a call with an incomplete configuration")
		}
	})

	t.Run("exchanges credentials for a token, then deletes the identity", func(t *testing.T) {
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		var tokenAudience, deletePath, deleteAuth, deleteMethod string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth/token" {
				_ = r.ParseForm()
				tokenAudience = r.Form.Get("audience")
				if r.Form.Get("grant_type") != "client_credentials" {
					t.Errorf("grant_type = %q", r.Form.Get("grant_type"))
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "mgmt-token"})
				return
			}
			deletePath, deleteAuth, deleteMethod = r.URL.Path, r.Header.Get("Authorization"), r.Method
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()
		auth0BaseURLOverride = srv.URL
		defer func() { auth0BaseURLOverride = "" }()

		called, err := DeleteAuth0User(context.Background(), "google-oauth2|100337785987015262344")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !called {
			t.Error("did not report the call it made")
		}
		// The audience is still derived from the real domain, not the override.
		if tokenAudience != "https://tenant.eu.auth0.com/api/v2/" {
			t.Errorf("audience = %q", tokenAudience)
		}
		if deleteMethod != http.MethodDelete {
			t.Errorf("method = %s, want DELETE", deleteMethod)
		}
		if deleteAuth != "Bearer mgmt-token" {
			t.Errorf("the delete did not carry the freshly minted token: %q", deleteAuth)
		}
		// The subject contains a "|", which must be escaped rather than left to
		// split the path.
		if !strings.HasPrefix(deletePath, "/api/v2/users/") {
			t.Errorf("path = %q", deletePath)
		}
		if strings.Contains(deletePath, " ") {
			t.Errorf("path was not escaped: %q", deletePath)
		}
	})

	t.Run("a custom domain does not move the audience", func(t *testing.T) {
		// **Regression test for a failure that only appears months later.**
		//
		// Auth0's rule for the Management API behind a custom domain is
		// asymmetric: the audience must stay the *canonical* tenant domain,
		// while the token request and the API call must share a host. Adding a
		// custom domain forces AUTH0_DOMAIN to become it - the Go API validates
		// the issuer of login tokens, which the custom domain would then mint -
		// so an audience derived from AUTH0_DOMAIN would silently follow it
		// somewhere Auth0 rejects, and deletion would start failing in a way
		// that reads like an Auth0 outage rather than a config mismatch.
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "auth.bigshop.app") // the custom domain
		t.Setenv("AUTH0_TENANT_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		var tokenAudience string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth/token" {
				_ = r.ParseForm()
				tokenAudience = r.Form.Get("audience")
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "t"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()
		auth0BaseURLOverride = srv.URL
		defer func() { auth0BaseURLOverride = "" }()

		if _, err := DeleteAuth0User(context.Background(), "auth0|123"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tokenAudience != "https://tenant.eu.auth0.com/api/v2/" {
			t.Errorf("audience = %q, want the canonical tenant domain - a custom domain here is rejected by Auth0", tokenAudience)
		}
		if strings.Contains(tokenAudience, "bigshop.app") {
			t.Errorf("the audience followed the custom domain: %q", tokenAudience)
		}
	})

	t.Run("without a custom domain the tenant domain is just AUTH0_DOMAIN", func(t *testing.T) {
		// The fallback, which is the state today: one variable, both uses, and
		// the split above changes nothing.
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		if got := auth0TenantDomain(); got != "tenant.eu.auth0.com" {
			t.Errorf("auth0TenantDomain() = %q, want it to fall back to AUTH0_DOMAIN", got)
		}
	})

	t.Run("a hostile subject cannot escape the users endpoint", func(t *testing.T) {
		// An Auth0 subject is not attacker-chosen today, but it is a string
		// interpolated into a URL path, and this is what stops it becoming a
		// way to reach another Management API endpoint.
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		for _, hostile := range []string{
			"../../clients/all",
			"auth0|1/../../connections",
			"auth0|1?fields=whatever",
			"auth0|1#fragment",
		} {
			var reached string
			var gotQuery string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/oauth/token" {
					_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "t"})
					return
				}
				reached, gotQuery = r.URL.Path, r.URL.RawQuery
				w.WriteHeader(http.StatusNoContent)
			}))
			auth0BaseURLOverride = srv.URL

			if _, err := DeleteAuth0User(context.Background(), hostile); err != nil {
				t.Fatalf("%q: unexpected error: %v", hostile, err)
			}
			// Whatever the subject contained, the request must still land under
			// the users collection with no query of its own.
			if !strings.HasPrefix(reached, "/api/v2/users/") {
				t.Errorf("%q escaped to %q", hostile, reached)
			}
			if gotQuery != "" {
				t.Errorf("%q smuggled a query string: %q", hostile, gotQuery)
			}
			srv.Close()
			auth0BaseURLOverride = ""
		}
	})

	t.Run("a 404 is success, so a retry of a partial deletion can finish", func(t *testing.T) {
		// The identity not being there is the state being asked for. Treating
		// it as a failure would make the sequence unretryable, which is the one
		// property its ordering exists to preserve.
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth/token" {
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "t"})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		auth0BaseURLOverride = srv.URL
		defer func() { auth0BaseURLOverride = "" }()

		if _, err := DeleteAuth0User(context.Background(), "auth0|gone"); err != nil {
			t.Errorf("a 404 should be success, got %v", err)
		}
	})

	t.Run("a rejected delete is an error, which aborts the sequence", func(t *testing.T) {
		// This is the hard gate doing its job: a working login for a deleted
		// account is the failure #59 exists to fix.
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth/token" {
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "t"})
				return
			}
			w.WriteHeader(http.StatusForbidden)
		}))
		defer srv.Close()
		auth0BaseURLOverride = srv.URL
		defer func() { auth0BaseURLOverride = "" }()

		if _, err := DeleteAuth0User(context.Background(), "auth0|123"); err == nil {
			t.Fatal("expected an error so the caller aborts before deleting anything")
		}
	})

	t.Run("a token failure aborts before any delete is attempted", func(t *testing.T) {
		clearAuth0Env(t)
		t.Setenv("AUTH0_DOMAIN", "tenant.eu.auth0.com")
		t.Setenv("AUTH0_MGMT_CLIENT_ID", "an-id")
		t.Setenv("AUTH0_MGMT_CLIENT_SECRET", "a-secret")

		var deleteAttempted bool
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth/token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			deleteAttempted = true
		}))
		defer srv.Close()
		auth0BaseURLOverride = srv.URL
		defer func() { auth0BaseURLOverride = "" }()

		if _, err := DeleteAuth0User(context.Background(), "auth0|123"); err == nil {
			t.Fatal("expected an error")
		}
		if deleteAttempted {
			t.Error("attempted the delete without a token")
		}
	})
}

// swapSteps replaces the four sequence steps for the duration of a test and
// restores them afterwards.
//
// These tests must never call t.Parallel(): the steps and the two base-URL
// variables above are package-level, so a parallel test would race another's
// substitution. Every test in this file also calls t.Setenv, which panics under
// t.Parallel and enforces that today - this comment is what stops a future test
// without a t.Setenv quietly breaking it.
func swapSteps(t *testing.T, order *[]string, softGateErr, auth0Err, hardDeleteErr error) {
	t.Helper()
	origSoft, origSendGrid, origAuth0, origHard, origRestore := softGateStep, sendGridStep, auth0Step, hardDeleteStep, restoreStep
	origConfirmation := confirmationStep
	t.Cleanup(func() {
		softGateStep, sendGridStep, auth0Step, hardDeleteStep, restoreStep = origSoft, origSendGrid, origAuth0, origHard, origRestore
		confirmationStep = origConfirmation
	})

	// Swapped out rather than left real, for the reason the real one exists:
	// SendTransactionalAsync spawns a goroutine, so leaving it in would race
	// the test's own recording of the order.
	confirmationStep = func(_ context.Context, _, _ string) {
		*order = append(*order, "confirmation")
	}

	softGateStep = func(_ context.Context, _ execer, _ string, _ int) error {
		*order = append(*order, "soft-gate")
		return softGateErr
	}
	restoreStep = func(_ context.Context, _ execer, _ string, _ int) error {
		*order = append(*order, "un-gate")
		return nil
	}
	sendGridStep = func(_ context.Context, _ string) (bool, error) {
		*order = append(*order, "sendgrid")
		return false, nil
	}
	auth0Step = func(_ context.Context, _ string) (bool, error) {
		*order = append(*order, "auth0")
		return true, auth0Err
	}
	hardDeleteStep = func(_ context.Context, _ *sql.DB, _ string, _ int, _ string) (bool, error) {
		*order = append(*order, "hard-delete")
		return true, hardDeleteErr
	}
}

// TestDeleteUserAndAccountSequence covers the property the spec's Phase 3
// "Done when" names: "the Auth0 failure path aborts without having destroyed
// anything."
func TestDeleteUserAndAccountSequence(t *testing.T) {
	t.Run("runs the four steps in the order the design requires", func(t *testing.T) {
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, nil, nil, nil)

		deleted, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !deleted {
			t.Error("did not report the account as deleted")
		}
		// "confirmation" sits between the gate and SendGrid, and that is the
		// assertion doing real work here. After the gate because that is when
		// the request is honoured; **before the erasure because the erasure
		// deletes everything SendGrid holds about the address**, so a
		// confirmation sent afterwards would re-create the recipient record it
		// had just removed.
		want := []string{"soft-gate", "confirmation", "sendgrid", "auth0", "hard-delete"}
		if strings.Join(order, ",") != strings.Join(want, ",") {
			t.Errorf("sequence = %v, want %v", order, want)
		}
	})

	t.Run("a failing Auth0 hard gate aborts before anything irreversible", func(t *testing.T) {
		// The whole reason the sequence is ordered this way. Auth0 surviving
		// while the database is gone leaves a working login resolving to
		// nothing, which is the failure #59 exists to fix - so when the gate
		// fails, the cascade must not run at all.
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, nil, errors.New("tenant said no"), nil)

		deleted, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com")
		if err == nil {
			t.Fatal("expected the hard gate to abort the sequence")
		}
		if deleted {
			t.Error("reported a deletion that did not happen")
		}
		for _, step := range order {
			if step == "hard-delete" {
				t.Fatal("the irreversible step ran after the hard gate failed")
			}
		}
		// And the soft gate did run, which is what leaves the Account
		// unreachable-but-retryable rather than untouched.
		if len(order) == 0 || order[0] != "soft-gate" {
			t.Errorf("the account was not gated before the attempt: %v", order)
		}
	})

	t.Run("a failing soft gate stops immediately", func(t *testing.T) {
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, errors.New("database down"), nil, nil)

		if _, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com"); err == nil {
			t.Fatal("expected an error")
		}
		if strings.Join(order, ",") != "soft-gate" {
			t.Errorf("kept going after the gate failed: %v", order)
		}
	})

	t.Run("the cascade is detached from the request's cancellation", func(t *testing.T) {
		// Once Auth0 has destroyed the identity, a client disconnecting must
		// not be able to stop the cascade - that would leave rows intact for
		// somebody who can no longer log in to retry, which is the one outcome
		// the ordering exists to prevent.
		clearAuth0Env(t)
		var order []string
		var cascadeCtxErr error
		swapSteps(t, &order, nil, nil, nil)
		hardDeleteStep = func(ctx context.Context, _ *sql.DB, _ string, _ int, _ string) (bool, error) {
			order = append(order, "hard-delete")
			cascadeCtxErr = ctx.Err()
			return true, nil
		}

		ctx, cancel := context.WithCancel(context.Background())
		cancel() // the client has already gone away

		if _, err := DeleteUserAndAccount(ctx, nil, "auth0|1", 7, "Bob", "bob@example.com"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cascadeCtxErr != nil {
			t.Errorf("the cascade inherited the cancellation (%v), so a disconnect could strand a deleted identity with live rows", cascadeCtxErr)
		}
	})
}

// TestFailedDeletionLeavesTheAccountReachable is a regression test for an
// account-bricking bug.
//
// The sequence's soft gate sets `account_user.enabled = false`, and
// GetAccountID filters on `enabled = true`. So a failure at any later step used
// to leave the person unable to resolve an Account at all - not merely unable
// to retry the deletion, but unable to use any account-scoped route, with
// nothing anywhere to put it back. Meanwhile the handler returned a 500 and the
// UI told them to try again, which could not work.
//
// "Any failure leaves a gated, retryable Account rather than a half-deleted
// one" is the claim the whole ordering exists to support. This is what makes it
// true.
func TestFailedDeletionLeavesTheAccountReachable(t *testing.T) {
	t.Run("the Auth0 hard gate failing restores access", func(t *testing.T) {
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, nil, errors.New("tenant said no"), nil)

		if _, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com"); err == nil {
			t.Fatal("expected an error")
		}
		if !contains(order, "un-gate") {
			t.Errorf("the account was left gated and unreachable after a failed deletion: %v", order)
		}
		// And it happens after the gate, not instead of it.
		if indexOf(order, "un-gate") < indexOf(order, "soft-gate") {
			t.Errorf("un-gated before gating: %v", order)
		}
	})

	t.Run("the cascade failing restores access", func(t *testing.T) {
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, nil, nil, errors.New("database down"))

		if _, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com"); err == nil {
			t.Fatal("expected an error")
		}
		if !contains(order, "un-gate") {
			t.Errorf("the account was left gated and unreachable after a failed cascade: %v", order)
		}
	})

	t.Run("a successful deletion does not un-gate", func(t *testing.T) {
		// There is nothing to restore - the membership row is gone - and an
		// UPDATE against it would be a pointless write on the happy path.
		clearAuth0Env(t)
		var order []string
		swapSteps(t, &order, nil, nil, nil)

		if _, err := DeleteUserAndAccount(context.Background(), nil, "auth0|1", 7, "Bob", "bob@example.com"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if contains(order, "un-gate") {
			t.Errorf("restored access to an account that was successfully deleted: %v", order)
		}
	})
}
