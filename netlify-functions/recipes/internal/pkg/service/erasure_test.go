package service

import (
	"context"
	"encoding/json"
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
