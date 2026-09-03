package service

import (
	"strings"
	"testing"
)

// The alias lookup is one statement and the whole multi-provider design rests on
// it, so each clause gets an assertion named for what its absence would do.
// dbConn hands back an *sql.Row, which has no exported constructor, so asserting
// on the statement is the only way to reach these without a database - the same
// reason otherMembersQuery is held apart in account.go.
func TestCanonicalUserQuery(t *testing.T) {
	q := canonicalUserQuery

	// Keyed on the subject, returning the person. The reverse - looking a
	// subject up by user id - is a different question with several answers, and
	// getting the direction wrong here would resolve every caller to whichever
	// login happened to sort first.
	if !strings.Contains(q, "WHERE subject = ?") {
		t.Errorf("the lookup is not keyed on the subject:\n%s", q)
	}
	if !strings.Contains(q, "SELECT user_id") {
		t.Errorf("the lookup does not return the person the subject belongs to:\n%s", q)
	}
}

// The caller resolution answers "who is this" and "which Account" together,
// because doing them separately would double the lookups common.Caller exists
// to collapse. Three properties make that safe, and all three live in the SQL.
func TestResolveCallerQuery(t *testing.T) {
	q := resolveCallerQuery

	// **A LEFT JOIN, not an inner one.** A person with no reachable Account is a
	// real state - between the deletion sequence's soft gate and its cascade, and
	// for the one request before POST /user has run. An inner join returns no
	// rows for them, which is indistinguishable from "this subject is a
	// stranger", and the two want completely different handling.
	if !strings.Contains(q, "LEFT JOIN") {
		t.Errorf("an inner join would make a user with no Account indistinguishable from an unknown subject:\n%s", q)
	}

	// `user_identity` has to be the anchor: the subject is the only thing the
	// request actually carries.
	if !strings.Contains(q, "FROM user_identity") {
		t.Errorf("the resolution is not anchored on the identity table:\n%s", q)
	}

	// **`enabled` belongs on the join, not in a WHERE clause.** In a WHERE it
	// would filter the whole row away, turning a person whose membership is
	// disabled into an unknown subject - so someone mid-deletion would resolve
	// to nobody and POST /user would hand them a brand new Account, undoing the
	// gate.
	joinPart, wherePart, found := strings.Cut(q, "WHERE")
	if !found {
		t.Fatalf("statement has no WHERE clause:\n%s", q)
	}
	if !strings.Contains(joinPart, "enabled = true") {
		t.Errorf("the enabled filter is not on the join:\n%s", q)
	}
	if strings.Contains(wherePart, "enabled") {
		t.Errorf("the enabled filter is in the WHERE clause, which turns a gated user into an unknown subject:\n%s", q)
	}
}

// The email match is what links a second provider to an existing person, so a
// miss here is not a missing feature - it is somebody handed an empty Account.
func TestUserWithEmailQuery(t *testing.T) {
	q := userWithEmailQuery

	// Both sides lowered. migrations/040 puts the column in utf8mb4_bin, where
	// `A` and `a` are different characters, and providers do not agree on the
	// case they return. Lowering only the parameter still misses
	// `Ada@Example.com` in the column.
	if strings.Count(q, "LOWER(") != 2 {
		t.Errorf("the comparison is not case-insensitive on both sides:\n%s", q)
	}

	// Keyed on the address and returning the person, not the reverse.
	if !strings.Contains(q, "SELECT id") {
		t.Errorf("the lookup does not return the person holding the address:\n%s", q)
	}
}
