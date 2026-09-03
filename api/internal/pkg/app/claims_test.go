package app

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// The claim decides whether somebody sees another person's invitations, so the
// rule that matters is not "it reads the address" but "it refuses to read the
// address unless the provider vouched for it".
func TestVerifiedEmailRequiresTheVerifiedFlag(t *testing.T) {
	cases := []struct {
		name   string
		claims *bigshopClaims
		want   string
	}{
		{
			name:   "verified",
			claims: &bigshopClaims{Email: "ada@example.com", EmailVerified: true},
			want:   "ada@example.com",
		},
		{
			// The whole point. An address the provider did not confirm is worth
			// exactly as much as one out of the request body.
			name:   "present but unverified",
			claims: &bigshopClaims{Email: "ada@example.com", EmailVerified: false},
			want:   "",
		},
		{
			name:   "no claims at all, as on a token minted before the Action",
			claims: &bigshopClaims{},
			want:   "",
		},
		{
			// Reachable: the type assertion in userMiddleware yields a nil
			// *bigshopClaims if the validator ever hands one back.
			name:   "nil receiver",
			claims: nil,
			want:   "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.claims.VerifiedEmail(); got != tc.want {
				t.Errorf("VerifiedEmail() = %q, want %q", got, tc.want)
			}
		})
	}
}

// Custom claims are decoded as part of token validation, so a claim that will
// not unmarshal rejects the token - on *every* request, for *every* user, since
// this claim rides on all of them. These cases are the difference between one
// bad Action edit being invisible and it being a total outage.
func TestAWeirdlyTypedClaimNeverFailsTheToken(t *testing.T) {
	cases := map[string]struct {
		raw  string
		want bool
	}{
		"a real bool":            {`{"https://bigshop.life/email_verified": true}`, true},
		"a real false":           {`{"https://bigshop.life/email_verified": false}`, false},
		"the string true":        {`{"https://bigshop.life/email_verified": "true"}`, true},
		"the string false":       {`{"https://bigshop.life/email_verified": "false"}`, false},
		"null":                   {`{"https://bigshop.life/email_verified": null}`, false},
		"a number":               {`{"https://bigshop.life/email_verified": 1}`, false},
		"an object":              {`{"https://bigshop.life/email_verified": {"a": 1}}`, false},
		"the claim not sent":     {`{}`, false},
		"an unrelated claim too": {`{"sub": "auth0|x"}`, false},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var claims bigshopClaims
			if err := json.Unmarshal([]byte(tc.raw), &claims); err != nil {
				t.Fatalf("decoding failed, which would 401 every request: %v", err)
			}
			if bool(claims.EmailVerified) != tc.want {
				t.Errorf("EmailVerified = %v, want %v", bool(claims.EmailVerified), tc.want)
			}
		})
	}
}

// Validate must not reject anything, for the same reason: it runs inside token
// validation, and a token without these claims is a token from before the
// Action was deployed rather than a token to refuse.
func TestClaimsValidateNeverRefusesAToken(t *testing.T) {
	if err := (&bigshopClaims{}).Validate(context.Background()); err != nil {
		t.Errorf("Validate refused an empty claim set: %v", err)
	}
}

// **The regression test for the invite vulnerability.**
//
// Before this change every route here matched invitations on `user.email`,
// which POST /user writes straight from its request body and refreshes on every
// login. So any authenticated person could name somebody else's address, list
// the invitation sent to it - GET /invites returns the token - and accept their
// way into that Account.
//
// The fix is that all three read the Caller's verified address instead, with no
// fallback. This test pins the "no fallback" half: a Caller carrying no
// verified email must get nothing, and it must get nothing *before* the
// database is consulted.
//
// A nil `db` is the mechanism and the assertion at once. Every one of these
// handlers dereferences `a.db` the moment it stops refusing, so if the guard is
// removed or moved below the lookup this test panics instead of failing
// politely - which is a louder signal than an assertion on a status code, and
// impossible to satisfy by accident.
func TestInviteRoutesRefuseATokenCarryingNoVerifiedEmail(t *testing.T) {
	application := &App{}
	ctx := application.withCaller(context.Background(), "auth0|somebody", "")

	t.Run("accept is forbidden", func(t *testing.T) {
		_, err := application.acceptInvite(ctx, &InviteTokenInput{})
		if err == nil {
			t.Fatal("accepting was allowed without a verified email")
		}
		if got := statusOf(err); got != http.StatusForbidden {
			t.Errorf("status = %d, want %d", got, http.StatusForbidden)
		}
	})

	t.Run("reject is forbidden", func(t *testing.T) {
		_, err := application.rejectInvite(ctx, &InviteTokenInput{})
		if err == nil {
			t.Fatal("rejecting was allowed without a verified email")
		}
		if got := statusOf(err); got != http.StatusForbidden {
			t.Errorf("status = %d, want %d", got, http.StatusForbidden)
		}
	})

	t.Run("listing is forbidden", func(t *testing.T) {
		_, err := application.getInvites(ctx, nil)
		if err == nil {
			t.Fatal("invitations were listed without a verified email")
		}
		if got := statusOf(err); got != http.StatusForbidden {
			t.Errorf("status = %d, want %d", got, http.StatusForbidden)
		}
	})

	// The route that writes the address every other one reads. It refuses for
	// the same reason and by the same helper - a fallback here would put the
	// welcome email, the onboarding sequence, the deletion confirmation and the
	// SendGrid erasure back under the caller's control.
	t.Run("creating a user is forbidden", func(t *testing.T) {
		_, err := application.addUser(ctx, &CreateUserInput{})
		if err == nil {
			t.Fatal("a user was created without a verified email")
		}
		if got := statusOf(err); got != http.StatusForbidden {
			t.Errorf("status = %d, want %d", got, http.StatusForbidden)
		}
	})
}

// The other half of the same rule: a Caller that *does* carry a verified
// address passes the guard and goes on to use it. Reaching the nil database is
// the proof it got past - there is nothing else to assert without one.
func TestAVerifiedEmailGetsPastTheInviteGuard(t *testing.T) {
	application := &App{}
	ctx := application.withCaller(context.Background(), "auth0|somebody", "ada@example.com")

	defer func() {
		if recover() == nil {
			t.Error("the handler returned without touching the database, so the guard refused a verified caller")
		}
	}()

	_, _ = application.getInvites(ctx, nil)
}
