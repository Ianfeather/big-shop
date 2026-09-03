package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// The refusal policy, exhaustively.
//
// checkLink is held apart from CompleteLink precisely so these can be reached
// without a database: every branch of it is a security property, and *sql.Row
// has no exported constructor, so the alternative is a live MySQL for what is
// really a table of conditions. Same seam as otherMembersQuery and hashInvites.
func TestCheckLink(t *testing.T) {
	const (
		source = "apple|000123.abc"
		target = "google-oauth2|54321"
		nonce  = "a-32-byte-random-value-from-the-browser"
	)
	now := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	live := pendingLink{grantedSubject: source, nonceHash: hashNonce(nonce), expires: now.Add(5 * time.Minute)}

	t.Run("the ordinary case passes", func(t *testing.T) {
		if err := checkLink(live, target, nonce, now); err != nil {
			t.Fatalf("checkLink() = %v, want nil", err)
		}
	})

	// Spec, Phase 1: "an expired token is refused". The purge is housekeeping
	// and may not have run; this is the check that actually decides.
	t.Run("an expired token is refused", func(t *testing.T) {
		expired := live
		expired.expires = now.Add(-1 * time.Second)
		if err := checkLink(expired, target, nonce, now); !errors.Is(err, ErrLinkExpired) {
			t.Fatalf("checkLink() = %v, want ErrLinkExpired", err)
		}
	})

	// The boundary, in the direction that matters: a token whose expiry is
	// exactly now is spent, not live. `now.Before(expires)` rather than
	// `!now.After(expires)`, and the difference is a whole second of a grant.
	t.Run("a token expiring exactly now is refused", func(t *testing.T) {
		boundary := live
		boundary.expires = now
		if err := checkLink(boundary, target, nonce, now); !errors.Is(err, ErrLinkExpired) {
			t.Fatalf("checkLink() at the boundary = %v, want ErrLinkExpired", err)
		}
	})

	// Spec, Phase 1: "a missing or wrong nonce is refused". This is the check
	// that makes the grant non-transferable - without it, an attacker starts a
	// link as themselves and sends the return URL to their victim, who signs in
	// perfectly normally and finishes holding the attacker's token.
	t.Run("a wrong nonce is refused", func(t *testing.T) {
		if err := checkLink(live, target, "some-other-browsers-nonce", now); !errors.Is(err, ErrLinkNonceMismatch) {
			t.Fatalf("checkLink() = %v, want ErrLinkNonceMismatch", err)
		}
	})

	t.Run("a missing nonce is refused", func(t *testing.T) {
		if err := checkLink(live, target, "", now); !errors.Is(err, ErrLinkNonceMismatch) {
			t.Fatalf("checkLink() = %v, want ErrLinkNonceMismatch", err)
		}
	})

	// Spec, "Accepted weaknesses": they must remember which provider they used
	// originally, and we cannot tell them - answering would turn this into an
	// account-enumeration oracle. So guessing is the intended behaviour, and a
	// wrong guess has to explain itself rather than silently do nothing.
	t.Run("signing back in with the same provider is refused and named", func(t *testing.T) {
		if err := checkLink(live, source, nonce, now); !errors.Is(err, ErrLinkSameIdentity) {
			t.Fatalf("checkLink() = %v, want ErrLinkSameIdentity", err)
		}
	})

	// The order is load-bearing: a caller holding a token but not its nonce
	// must learn nothing about whose token it is. If the same-identity check
	// ran first, presenting a stolen token would report "that is the sign-in
	// you are already using" - which is an answer to "is this token mine?".
	t.Run("the nonce is checked before anything about the identities", func(t *testing.T) {
		err := checkLink(live, source, "wrong", now)
		if !errors.Is(err, ErrLinkNonceMismatch) {
			t.Fatalf("checkLink() = %v, want ErrLinkNonceMismatch to win over ErrLinkSameIdentity", err)
		}
	})

	// And expiry before the nonce, so a dead token cannot be used to probe
	// nonces at leisure.
	t.Run("expiry is checked before the nonce", func(t *testing.T) {
		dead := live
		dead.expires = now.Add(-time.Hour)
		err := checkLink(dead, target, "wrong", now)
		if !errors.Is(err, ErrLinkExpired) {
			t.Fatalf("checkLink() = %v, want ErrLinkExpired to win over ErrLinkNonceMismatch", err)
		}
	})
}

// Spec, Phase 1: "a token bound to a different subject is refused."
//
// **The literal reading of that bullet is the flow's own happy path** - the
// caller at completion is always a different subject from the one the token
// names, because they have just re-authenticated as the account they are
// claiming. So what the property has to mean, and what these two assert, is
// that a token can only ever grant *the subject it was issued for*: the caller
// cannot redirect it, because nothing about the completion request names a
// subject at all. Presenting somebody else's token gets them nothing, and the
// nonce is what stops them presenting it in the first place.
//
// The second half - that the request cannot name a subject - is pinned
// structurally in app/link_test.go's TestLinkStartInputCannotNameASubject.
func TestCompleteLinkGrantsOnlyTheTokensOwnSubject(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	const (
		tokensSubject  = "apple|000123.abc"
		callersSubject = "google-oauth2|54321"
		targetUserID   = "user-who-already-had-the-recipes"
	)
	fake := &fakeExecer{}
	source := abandonedAccount{userID: tokensSubject, accountID: 9, emailDigest: HashEmail("x@y.z"), soleMember: true}

	// applyLink takes the subject from the row CompleteLink read, never from
	// anything the caller sent - so the caller's own subject must not appear
	// anywhere in the grant.
	if err := applyLink(context.Background(), fake, source, tokensSubject, targetUserID); err != nil {
		t.Fatalf("applyLink() error = %v", err)
	}

	for i, q := range fake.queries {
		if !strings.Contains(q, "INSERT INTO user_identity") {
			continue
		}
		if fake.args[i][0] != tokensSubject {
			t.Errorf("the grant names %v, want the token's own subject %q", fake.args[i][0], tokensSubject)
		}
		if fake.args[i][0] == callersSubject {
			t.Errorf("the grant names the *caller's* subject, so a stolen token could be redirected")
		}
	}
}

// Spec, Phase 1: "a source account holding recipes is refused."
//
// The refusal is not a nicety. Merging two populated accounts means duplicate
// recipes, two shopping lists, two sets of invites and the Global Catalog's
// ingredient lines, and is not what anybody in this situation is asking for.
func TestApplyLinkRefusesAnAccountWithRecipes(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	fake := &fakeExecer{}
	source := abandonedAccount{
		userID:      "apple|000123.abc",
		accountID:   9,
		emailDigest: HashEmail("relay@privaterelay.appleid.com"),
		soleMember:  true,
		recipes:     1,
	}

	err := applyLink(context.Background(), fake, source, "apple|000123.abc", "google-oauth2|54321")
	if !errors.Is(err, ErrLinkSourceHasRecipes) {
		t.Fatalf("applyLink() = %v, want ErrLinkSourceHasRecipes", err)
	}
	// The refusal comes *first*. A cascade that ran and then reported a
	// refusal would be rolled back by the caller's transaction, but relying on
	// that puts the safety of the whole thing in a `defer` two files away.
	if len(fake.queries) != 0 {
		t.Errorf("applyLink() ran %d statements before refusing:\n%v", len(fake.queries), fake.queries)
	}
}

// Spec, Phase 1: "a successful link leaves no orphaned `account` row."
//
// An `account` with no reachable member is exactly the state OtherAccountMembers
// and the deletion cascade were written to avoid, and linking is the one
// operation that can create one by accident - it creates nothing and *abandons*
// a whole account's worth of rows.
func TestApplyLinkLeavesNoOrphanedAccount(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	fake := &fakeExecer{}
	source := abandonedAccount{
		userID:      "apple|000123.abc",
		accountID:   9,
		emailDigest: HashEmail("relay@privaterelay.appleid.com"),
		soleMember:  true,
	}

	if err := applyLink(context.Background(), fake, source, "apple|000123.abc", "google-oauth2|54321"); err != nil {
		t.Fatalf("applyLink() error = %v", err)
	}

	tables := tablesTouched(fake.queries)
	// The account row itself, plus the two things that outlive it if the
	// sole-member branch is skipped.
	for _, want := range []string{"account", "account_user", "ga_account_uuid", "user", "user_identity"} {
		if !contains(tables, want) {
			t.Errorf("no statement touched %q - a linked-away account would be left behind:\n%v", want, fake.queries)
		}
	}
}

// The grant, and the ordering that makes it possible at all.
func TestApplyLinkGrantsTheSubjectAfterTheCascade(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	const (
		subject = "apple|000123.abc"
		target  = "google-oauth2|54321"
	)
	fake := &fakeExecer{}
	source := abandonedAccount{userID: subject, accountID: 9, emailDigest: HashEmail("x@y.z"), soleMember: true}

	if err := applyLink(context.Background(), fake, source, subject, target); err != nil {
		t.Fatalf("applyLink() error = %v", err)
	}

	// The insert is last, and it has to be: deleteAccountTx deletes
	// `user_identity WHERE user_id = <abandoned user>`, and `subject` is the
	// primary key of one of those rows. Inserting first is a duplicate key.
	last := fake.queries[len(fake.queries)-1]
	if !strings.Contains(last, "INSERT INTO user_identity") {
		t.Fatalf("the grant is not the last statement; got %q", last)
	}
	args := fake.args[len(fake.args)-1]
	if len(args) != 2 || args[0] != subject || args[1] != target {
		t.Errorf("the grant links %v, want [%q %q]", args, subject, target)
	}

	deleteIdentities, grant := -1, -1
	for i, q := range fake.queries {
		switch {
		case strings.Contains(q, "DELETE FROM user_identity"):
			deleteIdentities = i
		case strings.Contains(q, "INSERT INTO user_identity"):
			grant = i
		}
	}
	if deleteIdentities == -1 {
		t.Fatalf("the cascade never cleared the abandoned identities:\n%v", fake.queries)
	}
	if grant == -1 {
		t.Fatalf("the new sign-in was never granted access:\n%v", fake.queries)
	}
	if deleteIdentities > grant {
		t.Errorf("the abandoned identities are cleared at %d, after the grant at %d - which would delete the grant again",
			deleteIdentities, grant)
	}
}

// The shared-account branch, which is the one that must *not* delete an account.
//
// Not reachable from the flow as specified - somebody who has joined a shared
// account has almost certainly got recipes, and the refusal above catches
// that - but soleMember is computed from OtherAccountMembers rather than
// assumed, and this pins that the assumption is not quietly reintroduced.
func TestApplyLinkKeepsASharedAccount(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	fake := &fakeExecer{}
	source := abandonedAccount{userID: "apple|1", accountID: 9, emailDigest: HashEmail("x@y.z"), soleMember: false}

	if err := applyLink(context.Background(), fake, source, "apple|1", "google-oauth2|2"); err != nil {
		t.Fatalf("applyLink() error = %v", err)
	}

	for _, q := range fake.queries {
		if strings.Contains(q, "DELETE FROM account WHERE") {
			t.Errorf("a shared account was deleted:\n%v", fake.queries)
		}
	}
}

// The digest, not the address. Same reasoning as the deletion cascade's:
// `invite.email` stopped holding plaintext, so matching on one finds nothing.
func TestApplyLinkMatchesInvitesByDigest(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	digest := HashEmail("relay@privaterelay.appleid.com")
	fake := &fakeExecer{}
	source := abandonedAccount{userID: "apple|1", accountID: 9, emailDigest: digest, soleMember: true}

	if err := applyLink(context.Background(), fake, source, "apple|1", "google-oauth2|2"); err != nil {
		t.Fatalf("applyLink() error = %v", err)
	}

	found := false
	for i, q := range fake.queries {
		if strings.Contains(q, "DELETE FROM invite WHERE email") {
			found = true
			if len(fake.args[i]) != 1 || fake.args[i][0] != digest {
				t.Errorf("invites are matched on %v, not the digest %q", fake.args[i], digest)
			}
		}
	}
	if !found {
		t.Errorf("invites addressed to the abandoned user were never deleted:\n%v", fake.queries)
	}
}

// The nonce is stored as a digest, and the digest is not the nonce.
//
// Worth a test rather than a glance: the whole value of hashing it is that a
// database dump does not hand somebody the thing that makes a token usable.
func TestHashNonce(t *testing.T) {
	const nonce = "a-32-byte-random-value-from-the-browser"

	digest := hashNonce(nonce)
	if digest == nonce {
		t.Fatal("the nonce is stored as itself")
	}
	if len(digest) != 64 {
		t.Errorf("hashNonce() = %d characters, want 64 (hex sha-256)", len(digest))
	}
	if hashNonce(nonce) != digest {
		t.Error("hashNonce() is not deterministic, so no stored nonce could ever match")
	}
	if hashNonce(nonce+"!") == digest {
		t.Error("hashNonce() collides on a one-character difference")
	}
}

// The provider name is what the confirmation screen and the notification email
// say out loud, so a wrong one is worse than none: the job of both is to be
// believable.
func TestProviderName(t *testing.T) {
	cases := map[string]string{
		"google-oauth2|10769150350006150715113082367": "Google",
		"apple|000123.abcdef.0123":                    "Apple",
		"windowslive|4b8a9c":                          "Microsoft",
		"auth0|61e0d2f5":                              "email and password",
		// Unrecognised, and deliberately empty rather than a guess. Falling
		// back to the raw prefix would put a connection name nobody chose into
		// a sentence somebody is making a security decision about.
		"saml-corporate|abc": "",
		// No separator at all: not an Auth0 subject shape, so nothing to say.
		"nonsense": "",
		"":         "",
	}
	for subject, want := range cases {
		if got := ProviderName(subject); got != want {
			t.Errorf("ProviderName(%q) = %q, want %q", subject, got, want)
		}
	}
}
