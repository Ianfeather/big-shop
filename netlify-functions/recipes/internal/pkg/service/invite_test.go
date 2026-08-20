package service

import (
	"context"
	"regexp"
	"strings"
	"testing"
)

func TestHashEmail(t *testing.T) {
	t.Run("is a 64-character hex digest", func(t *testing.T) {
		t.Setenv("INVITE_EMAIL_PEPPER", "")
		got := HashEmail("bob@example.com")
		if len(got) != 64 {
			t.Fatalf("HashEmail returned %d characters, want 64: %q", len(got), got)
		}
		// The width matters beyond tidiness: looksHashed uses it to tell a
		// backfilled row from a plaintext one, and the column is a varchar(255)
		// component of a primary key.
		if !looksHashed(got) {
			t.Errorf("HashEmail's own output is not recognised by looksHashed: %q", got)
		}
	})

	t.Run("normalises case and surrounding whitespace", func(t *testing.T) {
		t.Setenv("INVITE_EMAIL_PEPPER", "")
		// The primary key is (account, email), so without this the same person
		// could hold two invite rows and reliably match neither.
		want := HashEmail("bob@example.com")
		for _, variant := range []string{"BOB@example.com", "  bob@example.com  ", "Bob@Example.Com"} {
			if got := HashEmail(variant); got != want {
				t.Errorf("HashEmail(%q) = %q, want it to match the normalised form %q", variant, got, want)
			}
		}
	})

	t.Run("different addresses give different digests", func(t *testing.T) {
		t.Setenv("INVITE_EMAIL_PEPPER", "")
		if HashEmail("bob@example.com") == HashEmail("alice@example.com") {
			t.Error("two different addresses hashed to the same digest")
		}
	})

	t.Run("the pepper changes the digest", func(t *testing.T) {
		// This is the whole reason it is an HMAC rather than a plain SHA-256:
		// without a pepper, anyone holding a database dump could confirm that a
		// specific named person had been invited by hashing their address and
		// grepping for it. If this test fails, the pepper is not reaching the
		// digest and that protection is gone - silently, since everything else
		// still works.
		t.Setenv("INVITE_EMAIL_PEPPER", "")
		unpeppered := HashEmail("bob@example.com")

		t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
		peppered := HashEmail("bob@example.com")

		if unpeppered == peppered {
			t.Error("the pepper made no difference to the digest")
		}
	})

	t.Run("is read from the environment per call, so rotation needs no redeploy", func(t *testing.T) {
		t.Setenv("INVITE_EMAIL_PEPPER", "first")
		first := HashEmail("bob@example.com")
		t.Setenv("INVITE_EMAIL_PEPPER", "second")
		if HashEmail("bob@example.com") == first {
			t.Error("the digest did not follow a change to the pepper")
		}
	})

	t.Run("never returns the address", func(t *testing.T) {
		t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
		// Belt and braces, but this is the property the whole change exists for.
		if got := HashEmail("bob@example.com"); strings.Contains(got, "bob") || strings.Contains(got, "@") {
			t.Errorf("digest contains part of the address: %q", got)
		}
	})
}

func TestLooksHashed(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "")

	for _, tc := range []struct {
		in   string
		want bool
	}{
		{HashEmail("bob@example.com"), true},
		// The cases that make the check safe without a marker column: no email
		// address can be 64 hex characters, because every address has an "@".
		{"bob@example.com", false},
		{"", false},
		// Right length, not hex.
		{strings.Repeat("z", 64), false},
		// Hex, wrong length.
		{strings.Repeat("a", 63), false},
		{strings.Repeat("a", 65), false},
	} {
		if got := looksHashed(tc.in); got != tc.want {
			t.Errorf("looksHashed(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestPurgeExpiredInvites(t *testing.T) {
	t.Run("deletes only rows that are already expired", func(t *testing.T) {
		fake := &fakeExecer{}
		purgeExpiredInvites(context.Background(), fake)

		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 statement, got %v", fake.queries)
		}
		q := fake.queries[0]
		if !strings.Contains(q, "DELETE FROM invite") || !strings.Contains(q, "expires <= ?") {
			t.Errorf("not a bounded expiry purge: %s", q)
		}
		// The bound is what stops this deleting live invites. A missing or
		// inverted predicate here would empty the table on the next account
		// page load, which nothing else in the suite would catch.
		if len(fake.args[0]) != 1 {
			t.Errorf("expected exactly one bound argument, got %v", fake.args[0])
		}
	})

	t.Run("a failure is swallowed rather than failing the caller", func(t *testing.T) {
		// Housekeeping must not break listing or creating an invite - it runs
		// on a read path precisely because there is no scheduler to run it on.
		fake := &fakeExecer{failOn: "DELETE FROM invite"}
		purgeExpiredInvites(context.Background(), fake)
	})
}

// hashInvites is the riskiest code in the invite change - it rewrites a primary
// key column in place - and this is the seam that lets it be tested without a
// database.
func TestHashInvites(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")

	t.Run("rewrites each row and then sweeps anything still plaintext", func(t *testing.T) {
		fake := &fakeExecer{}
		pending := []plaintextInvite{
			{account: 1, email: "bob@example.com"},
			{account: 1, email: "BOB@example.com"},
		}

		attempted, removed, err := hashInvites(context.Background(), fake, pending)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if attempted != len(pending) {
			t.Errorf("attempted = %d, want %d", attempted, len(pending))
		}
		// The sweep is table-wide, so `removed` reports what it actually
		// deleted rather than being derived from the batch size - deriving it
		// went negative the moment the sweep caught a straggler.
		if removed != 1 {
			t.Errorf("removed = %d, want the fake sweep's 1", removed)
		}
		// Two UPDATEs, then exactly one sweep.
		if len(fake.queries) != 3 {
			t.Fatalf("expected 2 updates and 1 sweep, got %v", fake.queries)
		}
		for i := 0; i < 2; i++ {
			if !strings.Contains(fake.queries[i], "UPDATE IGNORE invite") {
				t.Errorf("statement %d is not an ignoring update: %s", i, fake.queries[i])
			}
		}
		if !strings.Contains(fake.queries[2], "DELETE FROM invite") {
			t.Errorf("last statement is not the sweep: %s", fake.queries[2])
		}
	})

	t.Run("writes the digest, never the address", func(t *testing.T) {
		// The property the whole change exists for. If this regresses, every
		// other test here still passes.
		fake := &fakeExecer{}
		if _, _, err := hashInvites(context.Background(), fake,
			[]plaintextInvite{{account: 1, email: "bob@example.com"}}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		newValue, ok := fake.args[0][0].(string)
		if !ok {
			t.Fatalf("first argument is not a string: %v", fake.args[0][0])
		}
		if newValue != HashEmail("bob@example.com") {
			t.Errorf("wrote %q, want the digest %q", newValue, HashEmail("bob@example.com"))
		}
		if !looksHashed(newValue) {
			t.Errorf("the value written is not a digest: %q", newValue)
		}
		// The plaintext still appears - in the WHERE clause, which is how the
		// row is found. It must not be what gets stored.
		if fake.args[0][2] != "bob@example.com" {
			t.Errorf("the row is not located by its existing plaintext value: %v", fake.args[0])
		}
	})

	t.Run("two addresses differing only in case collide onto one digest", func(t *testing.T) {
		// Which is why the update ignores duplicates and why the sweep exists:
		// the primary key is (account, email), so the second update is a no-op
		// and its row has to be removed rather than left holding plaintext.
		if HashEmail("bob@example.com") != HashEmail("  BOB@Example.com ") {
			t.Fatal("normalisation is not producing the collision this code handles")
		}
	})

	t.Run("the sweep still runs when there is nothing to hash", func(t *testing.T) {
		// A previous run could have been interrupted between its updates and
		// its sweep, leaving a plaintext loser behind with no pending rows to
		// bring the sweep back.
		fake := &fakeExecer{}
		attempted, removed, err := hashInvites(context.Background(), fake, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if attempted != 0 {
			t.Errorf("attempted = %d, want 0", attempted)
		}
		// A straggler from an interrupted earlier run is still swept, and is
		// still counted - this is the case where deriving the count from the
		// batch size produced a negative number.
		if removed != 1 {
			t.Errorf("removed = %d, want the fake sweep's 1", removed)
		}
		if len(fake.queries) != 1 || !strings.Contains(fake.queries[0], "DELETE FROM invite") {
			t.Fatalf("expected just the sweep, got %v", fake.queries)
		}
	})

	t.Run("the sweep is bounded by the digest pattern", func(t *testing.T) {
		// Unbounded, this statement empties the invite table.
		fake := &fakeExecer{}
		if _, _, err := hashInvites(context.Background(), fake, nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(fake.queries[0], "NOT REGEXP") {
			t.Fatalf("the sweep has no predicate: %s", fake.queries[0])
		}
		if len(fake.args[0]) != 1 || fake.args[0][0] != hexDigestPattern {
			t.Errorf("the sweep is not bounded by the digest pattern: %v", fake.args[0])
		}
		// And the pattern must agree with looksHashed, or the two halves of
		// "is this already hashed" disagree and the sweep deletes live rows.
		if !regexp.MustCompile(hexDigestPattern).MatchString(HashEmail("bob@example.com")) {
			t.Error("hexDigestPattern does not match HashEmail's own output")
		}
		if regexp.MustCompile(hexDigestPattern).MatchString("bob@example.com") {
			t.Error("hexDigestPattern matches a plaintext address")
		}
	})

	t.Run("a failing update stops rather than sweeping", func(t *testing.T) {
		// The sweep deletes every row that is still plaintext, so running it
		// after a failed update would delete the very rows that failed to hash.
		fake := &fakeExecer{failOn: "UPDATE IGNORE invite"}
		_, _, err := hashInvites(context.Background(), fake,
			[]plaintextInvite{{account: 1, email: "bob@example.com"}})
		if err == nil {
			t.Fatal("expected an error")
		}
		for _, q := range fake.queries {
			if strings.Contains(q, "DELETE FROM invite") {
				t.Fatal("the sweep ran after an update failed, which would delete unhashed rows")
			}
		}
	})
}
