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
// That argument now covers the caller's *identity* as well as their Account.
// Since `user_identity` began aliasing one person's several Auth0 subjects to
// one `user.id`, "who is this" stopped being a fact carried in the token and
// became a query too - so it joined the same lazy, memoised resolution rather
// than being pushed back into the middleware.
//
// A Caller belongs to one request and must not be shared between them - the
// memoised Account is only correct for the user it was built for.
type Caller struct {
	// Subject is the raw `sub` from the validated token, before aliasing.
	//
	// Kept separate rather than folded into UserID because two callers need the
	// *login* rather than the person: telemetry, where `user.sub` is the join
	// key back to an Auth0 log entry and must therefore name the identity that
	// actually authenticated, and POST /user, which is the request that decides
	// what this subject resolves to and so cannot use the answer as its input.
	//
	// Nothing else should read it. If a query needs to know who somebody is,
	// UserID() is the answer; Subject is how they got here.
	Subject string

	// VerifiedEmail is the caller's email address **as asserted by the identity
	// provider inside the signed token**, or "" when the token carried none.
	//
	// **The empty string is the whole safety property**, and the field is shaped
	// this way deliberately. The obvious alternative - an Email plus an
	// EmailVerified bool - makes it possible to read the address and forget the
	// flag, which is precisely the mistake this exists to stop being possible.
	// Here there is nothing to forget: an unverified address never reaches this
	// field, so any non-empty value is one a provider vouched for.
	//
	// It is not the same thing as `user.email` in the database. That column is
	// written from the POST /user request *body*, which the caller controls, so
	// it is a display value and a mailing address and must never decide what
	// somebody may reach. Anything making that kind of decision reads this
	// instead - see app/invites.go, where the distinction was load-bearing
	// rather than theoretical.
	VerifiedEmail string

	// One lazy resolution answers both "who is this person" and "which Account
	// are they in", because it is one query - see NewCaller.
	resolve   func() (string, int, error)
	once      sync.Once
	userID    string
	accountID int
	err       error

	resolveAdmin func() (bool, error)
	adminOnce    sync.Once
	isAdmin      bool
	adminErr     error
}

// NewCaller builds a Caller for one request.
//
// The lookup arrives as a function rather than a database handle so that this
// package does not depend on `service`, which depends on this one. It also keeps
// the query itself in exactly one place: service.ResolveCaller, whose only
// caller this becomes.
//
// **It returns the person and the Account together because they come from one
// query.** Aliasing made "who is this" a database question rather than a fact
// already in the token, and answering it separately would have doubled the
// lookups the Caller was built to collapse. Joining `user_identity` to
// `account_user` costs nothing over the account lookup that was there before.
func NewCaller(subject, verifiedEmail string, resolve func() (string, int, error), resolveAdmin func() (bool, error)) *Caller {
	return &Caller{Subject: subject, VerifiedEmail: verifiedEmail, resolve: resolve, resolveAdmin: resolveAdmin}
}

// UserID is the person making the request, as `user.id` and every table
// referencing it spells them.
//
// **Not the same thing as the Auth0 subject**, and that difference is the whole
// of the multi-provider design. One person can sign in through Google and
// through Microsoft, arriving with a different `sub` each time; both resolve
// through `user_identity` to this one id, so nothing downstream can tell the two
// logins apart. See migrations/043_user_identity.sql.
//
// **A method rather than a field, and lazily resolved, because it is now a
// query.** Resolving it eagerly in the auth middleware was tried and reverted:
// it put a database call in front of every authenticated request, including the
// ones Huma rejects before any handler runs, and made a request that needs no
// database depend on one. It also turned an unresolvable identity into a silent
// fallback to the subject, where here it is an error a caller has to look at.
//
// The error is memoised as deliberately as the value: a subject with no
// `user_identity` row is a genuinely new person, and every route except POST
// /user should refuse them rather than invent an identity.
func (c *Caller) UserID() (string, error) {
	c.once.Do(func() {
		c.userID, c.accountID, c.err = c.resolve()
	})
	return c.userID, c.err
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
		c.userID, c.accountID, c.err = c.resolve()
	})
	return c.accountID, c.err
}

// IsAdmin reports whether this Caller may publish a Recipe as Featured,
// resolving it on first use and returning the same answer - including the same
// error - to every later call within the request.
//
// Lazy and memoised for exactly the reason AccountID is, and the arithmetic is
// even more one-sided: two write paths care whether the caller is an admin, and
// every other route in the API does not. Resolving eagerly in the auth
// middleware would add a query to all of them to serve those two.
//
// It is a *permission*, not a view preference. common.User also carries an
// IsAdmin, populated by GetUser and sent to the browser so the recipe form
// knows whether to render the Featured checkbox - that one is a hint for
// drawing a UI. This one is the thing writes are actually checked against, and
// the two must not be confused: a client can send whatever it likes, so a
// permission read from the request body is not a permission at all.
func (c *Caller) IsAdmin() (bool, error) {
	c.adminOnce.Do(func() {
		c.isAdmin, c.adminErr = c.resolveAdmin()
	})
	return c.isAdmin, c.adminErr
}
