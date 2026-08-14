package common

import "sync"

// Caller is who is making the current request: their user ID, and their
// Account resolved at most once for the lifetime of that request.
//
// It exists because every service function used to be independently
// responsible for answering "who is this". Twenty-one of them took a
// `userID string` and immediately looked the Account up for themselves, so a
// single POST /shopping-list resolved the same Account from the same user ID
// to the same answer **nine times** - each one a query, and each query two
// blocking round trips before Phase 2. Nobody noticed precisely because the
// knowledge was spread across twenty-one functions rather than held in one
// place.
//
// Resolution is *lazy*, which is the whole design and not an optimisation
// detail. Resolving eagerly in the auth middleware and putting the ID in the
// context would be simpler, and would make five routes slower: GET /tags,
// /units, /ingredients, /user and /invites make zero account lookups today,
// and eager resolution adds one to each. Lazily, zero stays zero and nine
// becomes one.
//
// A Caller belongs to one request and must not be shared between them - the
// memoised Account is only correct for the user it was built for.
type Caller struct {
	// UserID is the authenticated subject, as it appears in account_user.
	UserID string

	resolve   func() (int, error)
	once      sync.Once
	accountID int
	err       error
}

// NewCaller builds a Caller for one request.
//
// The Account lookup arrives as a function rather than a database handle so
// that this package does not depend on `service`, which depends on this one.
// It also keeps the query itself in exactly one place: service.GetAccountID,
// whose only caller this becomes.
func NewCaller(userID string, resolve func() (int, error)) *Caller {
	return &Caller{UserID: userID, resolve: resolve}
}

// AccountID returns the Account this Caller belongs to, resolving it on first
// use and returning the same answer - including the same error - to every
// later call within the request.
//
// The error is memoised as deliberately as the value. A user with no
// account_user row surfaces sql.ErrNoRows here, which handlers turn into a
// 500, and that behaviour is unchanged from when each service function asked
// for itself. It matters for POST /user, which is reachable by a genuinely new
// user who has no Account yet.
//
// One caveat, currently unexercised: memoisation means a request that *moves*
// the caller between Accounts cannot read the new one back through here.
// PATCH /invite is the only such request, and it carries the invite's account
// ID explicitly rather than asking - keep it that way.
func (c *Caller) AccountID() (int, error) {
	c.once.Do(func() {
		c.accountID, c.err = c.resolve()
	})
	return c.accountID, c.err
}
