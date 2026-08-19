package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"recipes/internal/pkg/telemetry"
)

// The three systems outside our database that hold something about a departing
// user, and the sequence that ties them to the cascade in account.go.
//
// See specs/account-deletion.md, "Sequencing across four systems". There is no
// distributed transaction here and no scheduler to retry with, so the ordering
// is chosen around which failure is survivable rather than around tidiness.

// erasureHTTPClient is the client every outbound erasure call uses.
//
// A short timeout on purpose: these are best-effort steps inside a request a
// person is waiting on, and the backstops (SendGrid's own 37-day expiry, a
// retry of the whole sequence) are better than making somebody watch a spinner
// while a third party is unreachable.
var erasureHTTPClient = &http.Client{Timeout: 10 * time.Second}

// The two external origins, held in variables so the tests can point them at an
// httptest server. Nothing but a test ever assigns to them, and neither is read
// from the environment - a deployment cannot accidentally send an erasure
// request somewhere else.
var (
	sendGridBaseURL = "https://api.sendgrid.com"
	// Empty means "derive it from AUTH0_DOMAIN", which is what production does.
	auth0BaseURLOverride string
)

// auth0BaseURL is the origin the Management API calls go to.
func auth0BaseURL() string {
	if auth0BaseURLOverride != "" {
		return auth0BaseURLOverride
	}
	return "https://" + os.Getenv("AUTH0_DOMAIN")
}

// EraseSendGridRecipient asks SendGrid to delete everything it holds about an
// address, and reports whether it actually called.
//
// **Best-effort by design.** SendGrid expires recipient personal data at 37
// days regardless, which is the backstop that lets this fail without failing
// the deletion. The caller logs and continues.
//
// **A missing SENDGRID_API_KEY is a clean skip, not an error.** It is unset
// everywhere today - board item #46 is what sets it - so treating absence as a
// failure would make every deletion report a problem that is really just "the
// email feature has not shipped yet".
//
// **Suppression entries are deliberately not purged.** A spam report or an
// unsubscribe is retained under the legal-obligation basis: deleting one so
// that we may lawfully mail somebody again inverts the point of the right being
// exercised here.
//
// The address must be read *before* the deletion transaction destroys the
// `user` row - see DeleteUserAndAccount, which does exactly that.
func EraseSendGridRecipient(ctx context.Context, email string) (called bool, err error) {
	key := os.Getenv("SENDGRID_API_KEY")
	if key == "" {
		return false, nil
	}

	// The Recipients' Data Erasure API takes a list of addresses, up to 5,000
	// per call, and is enabled by default for SendGrid accounts created after
	// 2023-07-25.
	body, err := json.Marshal(map[string][]string{"emails": {email}})
	if err != nil {
		return false, fmt.Errorf("encoding the erasure request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		sendGridBaseURL+"/v3/recipients/erasejob", bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("building the erasure request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	res, err := erasureHTTPClient.Do(req)
	if err != nil {
		return true, fmt.Errorf("calling SendGrid's erasure API: %w", err)
	}
	defer res.Body.Close()
	// Drained so the connection can be reused rather than dropped.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return true, fmt.Errorf("SendGrid's erasure API returned %d", res.StatusCode)
	}
	return true, nil
}

// auth0Configured reports whether the Management API credentials are present.
func auth0Configured() bool {
	return os.Getenv("AUTH0_DOMAIN") != "" &&
		os.Getenv("AUTH0_MGMT_CLIENT_ID") != "" &&
		os.Getenv("AUTH0_MGMT_CLIENT_SECRET") != ""
}

// auth0ManagementToken exchanges the machine-to-machine client credentials for
// a Management API token.
//
// Fetched per deletion rather than cached. Deletions are rare - this is not a
// hot path - and a cache would need invalidation logic whose failure mode is an
// expired token on the one request that must not fail.
func auth0ManagementToken(ctx context.Context) (string, error) {
	domain := os.Getenv("AUTH0_DOMAIN")

	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {os.Getenv("AUTH0_MGMT_CLIENT_ID")},
		"client_secret": {os.Getenv("AUTH0_MGMT_CLIENT_SECRET")},
		"audience":      {"https://" + domain + "/api/v2/"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		auth0BaseURL()+"/oauth/token", bytes.NewBufferString(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("building the Auth0 token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := erasureHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("requesting an Auth0 management token: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("Auth0's token endpoint returned %d", res.StatusCode)
	}

	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&token); err != nil {
		return "", fmt.Errorf("decoding the Auth0 token response: %w", err)
	}
	if token.AccessToken == "" {
		return "", fmt.Errorf("Auth0 returned no access token")
	}
	return token.AccessToken, nil
}

// DeleteAuth0User removes the identity a departing user logs in with, and
// reports whether it actually called.
//
// **This is the hard gate of the deletion sequence.** A working login for a
// deleted account is the failure board item #59 exists to fix, so when this
// fails the sequence stops before anything irreversible has happened and the
// user can retry.
//
// **When the Management credentials are absent it skips rather than failing.**
// That is the owner's decision, taken 2026-08-19, and it has a real cost worth
// stating here rather than only in a pull request: a production deploy that
// forgets AUTH0_MGMT_CLIENT_ID or AUTH0_MGMT_CLIENT_SECRET downgrades the hard
// gate to nothing, and deletes the database rows for somebody who can still log
// in. The alternative - erroring - fails closed but makes deletion impossible
// in dev, e2e and CI, where no Auth0 tenant is reachable at all.
//
// The skip is therefore made as loud as a skip can be: the caller records a
// warning naming the missing configuration on the request's span. See the board
// item tracking the secret being set.
func DeleteAuth0User(ctx context.Context, userID string) (called bool, err error) {
	if !auth0Configured() {
		return false, nil
	}

	token, err := auth0ManagementToken(ctx)
	if err != nil {
		return true, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		auth0BaseURL()+"/api/v2/users/"+url.PathEscape(userID), nil)
	if err != nil {
		return true, fmt.Errorf("building the Auth0 delete request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := erasureHTTPClient.Do(req)
	if err != nil {
		return true, fmt.Errorf("calling Auth0's Management API: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))

	// 404 is success for this purpose: the identity is not there, which is the
	// state being asked for. Treating it as a failure would make a retry of a
	// partly-completed deletion impossible, which is the one thing the
	// sequence's ordering exists to preserve.
	if res.StatusCode == http.StatusNotFound {
		return true, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return true, fmt.Errorf("Auth0's Management API returned %d", res.StatusCode)
	}
	return true, nil
}

// DeleteUserAndAccount runs the whole erasure sequence for one User.
//
// The order is the point, and it is chosen around which failure is survivable.
// The two bad outcomes are asymmetric: **Auth0 survives but the database is
// gone** leaves a working login resolving to nothing, which is precisely the
// failure #59 exists to fix; **the database survives but Auth0 is gone** leaves
// rows the user can no longer reach in order to retry.
//
//  1. Soft gate     account_user.enabled = false, scoped to (user, account).
//     The Account is unreachable from this instant, which is what
//     the user actually asked for. Everything after is cleanup.
//  2. SendGrid      Best-effort. Reads the address BEFORE step 4 destroys it.
//  3. Auth0         HARD GATE. On failure, abort - nothing irreversible has
//     happened yet, so the user can retry.
//  4. Hard delete   One transaction. The cascade in account.go.
//
// Any failure leaves a **gated, retryable Account** rather than a half-deleted
// one. That is why the soft gate leads rather than trails: it makes every later
// step safe to re-run by hand.
//
// It returns whether the Account itself was deleted, so the caller can tell the
// user which of the two outcomes happened.
func DeleteUserAndAccount(ctx context.Context, db *sql.DB, userID string, accountID int, email string) (accountDeleted bool, err error) {
	// 1. The soft gate. Deliberately an UPDATE: it is the only step before the
	//    hard delete that changes anything, and it is reversible.
	if err := DisableUserAccount(ctx, db, userID, accountID); err != nil {
		return false, fmt.Errorf("gating the account: %w", err)
	}

	// 2. SendGrid, best-effort, reading the address while the `user` row that
	//    holds it still exists.
	if called, err := EraseSendGridRecipient(ctx, email); err != nil {
		telemetry.RecordWarning(ctx, "sendgrid recipient erasure", err)
	} else if !called {
		telemetry.RecordWarning(ctx, "sendgrid recipient erasure skipped",
			fmt.Errorf("SENDGRID_API_KEY is not set; relying on SendGrid's 37-day expiry"))
	}

	// 3. Auth0, the hard gate.
	called, err := DeleteAuth0User(ctx, userID)
	if err != nil {
		// Abort with the Account still gated and every row intact. This is the
		// survivable failure, and keeping it survivable is the whole design.
		return false, fmt.Errorf("deleting the Auth0 identity: %w", err)
	}
	if !called {
		// Loud, because this is the configuration gap that would leave a
		// working login for a deleted account.
		telemetry.RecordWarning(ctx, "auth0 identity deletion skipped",
			fmt.Errorf("AUTH0_MGMT_CLIENT_ID/AUTH0_MGMT_CLIENT_SECRET are not set; the login for this deleted account is NOT being removed"))
	}

	// 4. The irreversible step, last. It reports which branch it took from
	//    inside its own transaction, so the caller can name the outcome without
	//    a second count against rows that no longer exist.
	return DeleteAccount(ctx, db, userID, accountID, email)
}
