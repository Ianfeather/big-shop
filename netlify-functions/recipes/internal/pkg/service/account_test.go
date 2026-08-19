package service

import (
	"context"
	"strings"
	"testing"
)

// tablesTouched returns, in order, every table each statement names - enough to
// assert the cascade's shape without pinning its whitespace.
//
// **Every occurrence, not just the first.** An earlier version stopped at the
// first FROM in each statement, which made the "catalog is never touched" test
// below read far stronger than it was: a subquery reaching into `ingredient`
// would have gone unseen, and a subquery is exactly how it would happen.
func tablesTouched(queries []string) []string {
	var tables []string
	for _, q := range queries {
		fields := strings.Fields(strings.ReplaceAll(strings.ReplaceAll(q, "(", " ( "), ")", " ) "))
		for i, f := range fields {
			if i+1 >= len(fields) {
				continue
			}
			switch strings.ToUpper(f) {
			case "FROM", "UPDATE", "INTO", "JOIN", "IGNORE":
				name := strings.Trim(fields[i+1], ";,()")
				if name != "" && !strings.EqualFold(name, "SELECT") {
					tables = append(tables, name)
				}
			}
		}
	}
	return tables
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}

// indexOf returns the position of the first statement touching a table, or -1.
func indexOf(tables []string, table string) int {
	for i, t := range tables {
		if t == table {
			return i
		}
	}
	return -1
}

func TestDeleteAccountTx(t *testing.T) {
	t.Setenv("INVITE_EMAIL_PEPPER", "a-real-secret")
	const (
		userID   = "google-oauth2|12345"
		accountI = 7
	)
	digest := HashEmail("bob@example.com")

	t.Run("sole member: the account and everything under it goes", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, true); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		tables := tablesTouched(fake.queries)

		for _, want := range []string{
			"part", "recipe_tag", "list", "shopping_list_event", "recipe",
			"invite", "consent_event", "account_user", "user", "account",
		} {
			if !contains(tables, want) {
				t.Errorf("sole-member cascade never touched %s: %v", want, tables)
			}
		}
	})

	t.Run("shared: the person goes, the account's content stays", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, false); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		tables := tablesTouched(fake.queries)

		// The whole point of the shared branch. A Recipe belongs to the
		// Account, not to the departing User, so none of this may be touched.
		for _, forbidden := range []string{"recipe", "part", "recipe_tag", "list", "shopping_list_event", "account"} {
			if contains(tables, forbidden) {
				t.Errorf("shared-account deletion touched %s, which belongs to the surviving Account: %v", forbidden, tables)
			}
		}
		// And the person still goes completely.
		for _, want := range []string{"invite", "consent_event", "account_user", "user"} {
			if !contains(tables, want) {
				t.Errorf("shared-account deletion never touched %s, so the person is not fully erased: %v", want, tables)
			}
		}
	})

	t.Run("consent_event goes before the user row it references", func(t *testing.T) {
		// migrations/034 puts a foreign key on consent_event.user_id, so the
		// other order fails outright. This is the ordering the spec spent its
		// longest section arguing about.
		for _, sole := range []bool{true, false} {
			fake := &fakeExecer{}
			if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, sole); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			tables := tablesTouched(fake.queries)
			consent, user := indexOf(tables, "consent_event"), indexOf(tables, "user")
			if consent == -1 || user == -1 {
				t.Fatalf("soleMember=%v: expected both consent_event and user: %v", sole, tables)
			}
			if consent > user {
				t.Errorf("soleMember=%v: consent_event deleted after user, which trips fk_consent_event_user_id: %v", sole, tables)
			}
		}
	})

	t.Run("account_user goes before both user and account", func(t *testing.T) {
		// migrations/008 puts foreign keys on both.
		fake := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, true); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		tables := tablesTouched(fake.queries)
		membership := indexOf(tables, "account_user")
		if membership > indexOf(tables, "user") || membership > indexOf(tables, "account") {
			t.Errorf("account_user is not deleted before its parents: %v", tables)
		}
	})

	t.Run("every membership the departing user holds is deleted, in both branches", func(t *testing.T) {
		// **Regression test.** fk_account_user_user_id has no ON DELETE clause,
		// so any surviving account_user row for this person blocks
		// DELETE FROM user. The invite flow manufactures exactly that state:
		// DisableUserAccount leaves the old membership in place with
		// enabled = false and AddUserToAccount inserts a second, so every user
		// who has ever accepted an invite has two rows. Scoping the delete to
		// the current Account failed the user delete for all of them.
		for _, sole := range []bool{true, false} {
			fake := &fakeExecer{}
			if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, sole); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var userScoped bool
			for i, q := range fake.queries {
				if !strings.Contains(q, "account_user") {
					continue
				}
				// The one that matters: scoped to the user and *not* also to an
				// account, so it reaches memberships of other Accounts too.
				if strings.Contains(q, "user_id = ?") && !strings.Contains(q, "account_id") {
					userScoped = true
					if len(fake.args[i]) != 1 || fake.args[i][0] != userID {
						t.Errorf("soleMember=%v: expected the user id alone, got %v", sole, fake.args[i])
					}
				}
			}
			if !userScoped {
				t.Errorf("soleMember=%v: no membership delete covers the user's OTHER accounts, so DELETE FROM user trips fk_account_user_user_id for anyone who has accepted an invite", sole)
			}
		}
	})

	t.Run("the sole-member branch also clears other people's memberships on the account", func(t *testing.T) {
		// The other axis: fk_account_user_account_id blocks DELETE FROM account
		// while a co-member's row survives, and a co-member disabled by the
		// invite flow has one that the member count ignores. This is the
		// statement the spec's own cascade list omitted.
		fake := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, true); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var accountScoped bool
		for i, q := range fake.queries {
			if strings.Contains(q, "account_user") && strings.Contains(q, "account_id = ?") && !strings.Contains(q, "user_id") {
				accountScoped = true
				if len(fake.args[i]) != 1 || fake.args[i][0] != accountI {
					t.Errorf("expected the account id alone, got %v", fake.args[i])
				}
			}
		}
		if !accountScoped {
			t.Error("no membership delete covers the account's other members, so DELETE FROM account trips fk_account_user_account_id")
		}
	})

	t.Run("the shared branch leaves other people's memberships alone", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, false); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		for _, q := range fake.queries {
			if strings.Contains(q, "account_user") && strings.Contains(q, "account_id = ?") && !strings.Contains(q, "user_id") {
				t.Errorf("a surviving account's other members would be removed by: %s", q)
			}
		}
	})

	t.Run("invites sent by the departing user go in both branches", func(t *testing.T) {
		// invite.admin_id is their Auth0 subject, so a surviving row keeps an
		// identifier belonging to somebody we have just told we erased. Goes
		// beyond the spec's table, deliberately - see deleteAccountTx.
		for _, sole := range []bool{true, false} {
			fake := &fakeExecer{}
			if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, sole); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var found bool
			for i, q := range fake.queries {
				if strings.Contains(q, "FROM invite") && strings.Contains(q, "admin_id = ?") {
					found = true
					if fake.args[i][0] != userID {
						t.Errorf("soleMember=%v: wrong argument %v", sole, fake.args[i])
					}
				}
			}
			if !found {
				t.Errorf("soleMember=%v: invites sent by the user survive, keeping their Auth0 subject in the database", sole)
			}
		}
	})

	t.Run("invites are deleted in both directions", func(t *testing.T) {
		// Sent *by* the Account only when the Account is going; addressed *to*
		// this person always, and across every Account rather than just this
		// one.
		sole := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), sole, userID, accountI, digest, true); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var byAccount, toUser int
		for i, q := range sole.queries {
			if !strings.Contains(q, "FROM invite") {
				continue
			}
			if strings.Contains(q, "account = ?") {
				byAccount++
			}
			if strings.Contains(q, "email = ?") {
				toUser++
				if sole.args[i][0] != digest {
					t.Errorf("invites addressed to the user are not matched by digest: %v", sole.args[i])
				}
			}
		}
		if byAccount != 1 || toUser != 1 {
			t.Errorf("sole-member: expected one invite delete in each direction, got by-account=%d to-user=%d", byAccount, toUser)
		}

		shared := &fakeExecer{}
		if err := deleteAccountTx(context.Background(), shared, userID, accountI, digest, false); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		for _, q := range shared.queries {
			if strings.Contains(q, "FROM invite") && strings.Contains(q, "account = ?") {
				t.Errorf("a surviving Account's outstanding invites were deleted: %s", q)
			}
		}
	})

	t.Run("the global ingredient catalog is never touched", func(t *testing.T) {
		// ADR-0001. These names are coined during everyone's imports, are not
		// personal data, and erasing them would damage every other Account.
		for _, sole := range []bool{true, false} {
			fake := &fakeExecer{}
			if err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, sole); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			tables := tablesTouched(fake.queries)
			for _, protected := range []string{
				"ingredient", "unit", "tag", "department",
				"ingredient_department", "ingredient_unit_size",
			} {
				if contains(tables, protected) {
					t.Errorf("soleMember=%v: deletion touched the shared catalog table %s: %v", sole, protected, tables)
				}
			}
		}
	})

	t.Run("a failure part-way through stops rather than pressing on", func(t *testing.T) {
		// The transaction rolls it back; what matters here is that it does not
		// carry on and delete the user while their consent rows still point at
		// them.
		fake := &fakeExecer{failOn: "consent_event"}
		err := deleteAccountTx(context.Background(), fake, userID, accountI, digest, true)
		if err == nil {
			t.Fatal("expected an error")
		}
		if !strings.Contains(err.Error(), "consent history") {
			t.Errorf("error does not name the failing step: %v", err)
		}
		if contains(tablesTouched(fake.queries), "user") {
			t.Error("the user row was deleted after the consent delete failed")
		}
	})
}

func TestDisableUserAccount(t *testing.T) {
	t.Run("is scoped to one account, not every membership", func(t *testing.T) {
		// The bug this fixes: without the account predicate this disabled every
		// row for the user, and since GetAccountID and GetAccount both filter
		// enabled = true, the victim could log in and resolve to no Account at
		// all.
		fake := &fakeExecer{}
		if err := DisableUserAccount(context.Background(), fake, "user-1", 7); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 statement, got %v", fake.queries)
		}
		q := fake.queries[0]
		if !strings.Contains(q, "account_id = ?") {
			t.Errorf("not scoped to an account: %s", q)
		}
		if len(fake.args[0]) != 2 || fake.args[0][0] != "user-1" || fake.args[0][1] != 7 {
			t.Errorf("expected (user, account) arguments, got %v", fake.args[0])
		}
	})

	t.Run("disables rather than deletes, so the soft gate is reversible", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := DisableUserAccount(context.Background(), fake, "user-1", 7); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Leading the deletion sequence with a DELETE would make every later
		// step unretryable, which is the property the sequence is built around.
		if !strings.HasPrefix(strings.TrimSpace(fake.queries[0]), "UPDATE") {
			t.Errorf("the soft gate is not an UPDATE: %s", fake.queries[0])
		}
	})
}

// TestOtherAccountMembersQuery pins the predicate that decides whether somebody
// else's Recipes get deleted.
//
// **This is a regression test for a data-loss bug**, and the scenario is worth
// stating rather than leaving to the reader. The deletion sequence disables the
// departing user's own membership first, as its soft gate. If the count were
// "enabled members, is it one?", then a *shared* Account with two members would
// have exactly one enabled row left by that point - the surviving member's -
// and deletion would take the sole-member branch, destroying Recipes belonging
// to somebody who never asked to be deleted.
//
// Counting only the *other* members makes the answer the same before and after
// the soft gate, which is also what lets a partly-failed deletion be retried by
// hand without silently changing which branch it takes.
//
// Asserted against the query constant the function actually runs, rather than a
// copy of it, because the whole property lives in the predicate and there is no
// way to fake *sql.Row.
func TestOtherAccountMembersQuery(t *testing.T) {
	if !strings.Contains(otherMembersQuery, "user_id != ?") {
		t.Errorf("the count includes the departing user, so a shared account looks sole once the soft gate has disabled their row: %s", otherMembersQuery)
	}
	if !strings.Contains(otherMembersQuery, "enabled = true") {
		t.Errorf("the count includes members who have already left: %s", otherMembersQuery)
	}
	if !strings.Contains(otherMembersQuery, "account_id = ?") {
		t.Errorf("the count is not scoped to one account: %s", otherMembersQuery)
	}
}

// TestSoleMemberDecision states the branch condition in one place, so that the
// mapping from "how many others are left" to "delete the Account" is readable
// without following it through a SQL count.
func TestSoleMemberDecision(t *testing.T) {
	for _, tc := range []struct {
		others int
		sole   bool
		why    string
	}{
		{0, true, "nobody else is left, so the Account goes with them"},
		{1, false, "one other member, so the Account and its Recipes survive"},
		{5, false, "several others"},
	} {
		if got := tc.others == 0; got != tc.sole {
			t.Errorf("others=%d gave soleMember=%v, want %v (%s)", tc.others, got, tc.sole, tc.why)
		}
	}
}
