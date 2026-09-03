package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"recipes/internal/pkg/common"
	"recipes/internal/pkg/telemetry"
)

// Account linking recovery: letting somebody who signed in a new way get back
// to the recipes they already had.
//
// See specs/completed/account-linking-recovery.md. The short version is that
// LinkOrCreateIdentity links a second provider to an existing person **when the
// verified email matches**, and this file is for the people that clause misses:
// Apple Private Relay addresses, which can never match anything, and anybody
// whose second provider hands over a different address that is genuinely theirs.
// They get an empty Account and no error anywhere, because at the level of the
// data there is nothing wrong.
//
// **The recovery is deliberately not an emailed confirmation link.** That design
// is an authorisation grant wearing an email verification: signup is open, so an
// attacker could make Big Shop send an unsolicited "confirm this is your
// account" mail to any address, carrying our credibility to somebody with no
// context for judging it, and one click would bond the attacker's login to their
// account permanently. Auth0's own Account Link Extension refuses to auto-link
// even when both addresses are verified, for the weaker version of the same
// reason. And it is unnecessary: the person is sitting in front of the
// application and can prove they own the other account the strongest way there
// is, by signing into it.
//
// So the flow is start -> re-authenticate as the original identity -> confirm ->
// complete, and the two halves of it are StartLink and CompleteLink below.

// linkTokenTTL is how long a started link stays redeemable.
//
// Long enough to sign in with a second provider, including the "which one did I
// use?" pause that is the whole reason somebody is here, and short enough that
// an abandoned attempt is not sitting in the table as a live grant. Nothing
// resumes an expired one: the person clicks the link again and gets a fresh
// token, which costs them one click and costs an attacker the entire window.
const linkTokenTTL = 15 * time.Minute

// The ways a link can be refused.
//
// Sentinels rather than formatted errors because the handler has to turn each
// into a different thing for the person to read - "that request has expired" and
// "you already have recipes in this account" are different advice - and
// matching on message text is how that quietly stops working.
var (
	// ErrLinkUnknown covers a token that was never issued, has already been
	// redeemed, or has been purged. **One error for all three deliberately**:
	// telling a caller which would say whether a token they are guessing at
	// ever existed.
	ErrLinkUnknown = errors.New("no pending link for this token")

	// ErrLinkExpired is a token past linkTokenTTL. Distinct from
	// ErrLinkUnknown because it is the one of the four that has a useful
	// remedy - start again - and the person did nothing wrong.
	ErrLinkExpired = errors.New("this link request has expired")

	// ErrLinkNonceMismatch is the browser binding failing: the completion did
	// not come from the browser that started it. See CompleteLink for why this
	// is the check that makes the grant non-transferable.
	ErrLinkNonceMismatch = errors.New("this link request was started in a different browser")

	// ErrLinkSameIdentity means they signed in again with the provider they
	// were already using. Named as its own case because it is the likeliest
	// honest mistake in the whole flow - the spec's accepted weakness is that
	// we cannot tell somebody which provider they originally used, so guessing
	// is the intended behaviour and a wrong guess must explain itself.
	ErrLinkSameIdentity = errors.New("that is the same sign-in you are already using")

	// ErrLinkAlreadyLinked means the two subjects already resolve to one
	// person. Nothing to do, and saying so is better than reporting success
	// for a link that was not made.
	ErrLinkAlreadyLinked = errors.New("these two sign-ins already reach the same account")

	// ErrLinkSourceHasRecipes is the refusal the whole "abandoned account"
	// section of the spec exists for - see applyLink.
	ErrLinkSourceHasRecipes = errors.New("the account being linked from still holds recipes")

	// ErrLinkSourceUnreachable means the identity that started the link no
	// longer resolves to a person with an Account. Not reachable from the
	// flow - the person who starts a link is signed in and using the app - and
	// refused rather than worked around, because the workarounds all end in an
	// orphaned `account` row. See CompleteLink.
	ErrLinkSourceUnreachable = errors.New("the sign-in that started this link no longer has an account")
)

// hashNonce is how the browser's nonce is stored and compared.
//
// A plain SHA-256, not the peppered HMAC HashEmail uses, and the difference is
// the input rather than the storage: an email address comes from an enumerable
// space, so an unpeppered digest of one lets anybody holding a database dump
// confirm a guess. A 32-byte random nonce cannot be guessed at all, so a pepper
// would defend against nothing while adding a deployment secret this table would
// silently stop working without.
func hashNonce(nonce string) string {
	sum := sha256.Sum256([]byte(nonce))
	return hex.EncodeToString(sum[:])
}

// purgeExpiredLinks deletes link requests that are past their expiry.
//
// Lazily, for exactly the reasons purgeExpiredInvites gives: there is no
// scheduler anywhere in this architecture, the table is tiny, and inventing one
// for a single DELETE is disproportionate.
//
// **Called from StartLink and deliberately NOT from CompleteLink**, which is
// the opposite of what purgeExpiredInvites does and is the more interesting
// half of this comment. Purging on the redemption path destroys the row a
// moment before it is read, so an expired token comes back as ErrLinkUnknown -
// "that request is no longer valid" - instead of ErrLinkExpired's "it expired,
// start again and finish within a few minutes". The distinction is the whole
// reason linkRefusal is a table: one of those has a remedy the person can act
// on and the other reads like something is broken. It was written that way
// first, and nothing noticed, because the expiry test drives checkLink
// directly and never travels the path the purge is on.
//
// Purging only on the write path is enough to keep the table shallow: StartLink
// is its only writer, so every new row sweeps the dead ones.
//
// Failure is recorded and swallowed. A caller starting a link should not fail
// because an unrelated dead row could not be cleaned up.
func purgeExpiredLinks(ctx context.Context, db execer) {
	if _, err := db.ExecContext(ctx, "DELETE FROM pending_link WHERE expires <= ?;", time.Now()); err != nil {
		telemetry.RecordWarning(ctx, "purge expired pending links", err)
	}
}

// StartLink records a link attempt for one Auth0 subject and returns the token
// that redeems it.
//
// **`subject` is always the caller's own**, taken from the validated token by
// the handler and never from a request body. It is the identity that will be
// *granted* access if this completes, so a caller able to name somebody else's
// subject here could start a link that hands that stranger's login their
// account - the request would be spelled entirely in public values.
//
// The nonce arrives already generated by the browser, which is the only place it
// can be: its job is to prove that whoever finishes the link is in the same
// browser that started it, and a value the server minted and sent back would
// travel the same path as the token and prove nothing about the browser at all.
// Only its digest is stored - see hashNonce.
//
// Any previous attempt by this subject is cleared first, so at most one is live
// at a time. That is hygiene rather than a safety property (each token needs its
// own nonce, so a stale one is inert), but it keeps "start again" from meaning
// "leave a second grant lying around".
func StartLink(ctx context.Context, db *sql.DB, subject, nonce string) (string, error) {
	purgeExpiredLinks(ctx, db)

	// 32 bytes, the same width CreateInvite's token uses. It is a bearer value
	// for the length of linkTokenTTL and is useless without the nonce, but it
	// is still one of two things standing between a stranger and an account,
	// so it is generated the same way rather than a shorter, friendlier one.
	token, err := common.RandToken(32)
	if err != nil {
		return "", fmt.Errorf("generating a link token: %w", err)
	}

	// **Transactional, for the clear-then-insert.** Separately, a failed insert
	// after a successful delete leaves the person with their previous attempt
	// gone and no new one - and the symptom is a confirmation screen that says
	// there is nothing to finish, which reads as the nonce binding having failed
	// rather than as a write that did not happen.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM pending_link WHERE granted_subject = ?;", subject); err != nil {
		return "", fmt.Errorf("clearing this subject's previous link requests: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		"INSERT INTO pending_link (token, granted_subject, nonce_hash, expires) VALUES (?, ?, ?, ?);",
		token, subject, hashNonce(nonce), time.Now().Add(linkTokenTTL)); err != nil {
		return "", fmt.Errorf("recording the link request: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("committing the link request: %w", err)
	}

	return token, nil
}

// LinkOutcome is what a completed link needs to say about itself.
//
// It carries the *surviving* person rather than the abandoned one, because its
// only consumer is the notification email - which goes to the address that
// already had the account, telling them a new way of signing in was added. The
// abandoned user's address is gone by the time this is returned, along with
// every other row belonging to them.
type LinkOutcome struct {
	// LinkedSubject is the Auth0 subject that can now reach this Account. Not
	// sent anywhere near a browser: it is a stable identifier for a person at
	// their identity provider, and ADR-0008 keeps those out of anything
	// user-facing. Provider below is what the email actually says.
	LinkedSubject string
	// Provider is the human name of the identity provider that subject belongs
	// to - "Apple", "Google" - or "" when the prefix is not one we recognise.
	Provider string
	// Name and Email identify the surviving user, for the notification.
	Name  string
	Email string
}

// CompleteLink redeems a started link: the subject the token names gains access
// to the Account the *caller* is signed into, and the Account that subject used
// to reach is erased.
//
// **`targetSubject` is the caller's own, freshly re-authenticated.** Step 4 of
// the flow sends them back to Auth0 with `prompt=login`, so the existing session
// cannot be silently reused and they have to actively sign in as the account
// they are claiming. That re-authentication *is* the proof of ownership, and it
// is the reason this design needs no emailed confirmation.
//
// **The nonce is what makes the grant non-transferable, and skipping it is easy
// to talk yourself into.** Re-authentication alone leaves a live attack:
// somebody starts a link as themselves, sends the return URL to their victim,
// and the victim - asked to sign in, which looks entirely normal - signs in as
// themselves and finishes holding *the attacker's* token. The attacker's login
// is then bonded to the victim's account. Re-authentication proved the victim
// owns the account; it never proved that the person who started the link is the
// person who finished it. The nonce, held in the starting browser's own storage
// and required here, is the ordinary CSRF state defence applied to the right
// thing: a URL pasted into another browser has nothing to match and is inert.
//
// **The subject that gets linked comes from the row, never from the request.**
// There is no way to spell a completion that links an identity other than the
// one the token was issued for, which is what stops a stolen token from being
// pointed anywhere useful even by somebody who also has its nonce.
//
// Everything happens in one transaction, and it has to: the cascade below erases
// a whole Account's worth of rows and the INSERT that follows is the only thing
// that gives the person any way back in. Half-applied in either direction is a
// person locked out of both accounts.
func CompleteLink(ctx context.Context, db *sql.DB, targetSubject, token, nonce string) (*LinkOutcome, error) {
	// No purgeExpiredLinks here, deliberately - see its comment. Sweeping the
	// table on this path deletes an expired row a moment before it is read, so
	// "that expired, try again" becomes "that was never valid".

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("starting transaction: %w", err)
	}
	defer tx.Rollback()

	// FOR UPDATE so two completions of one token serialise rather than both
	// reading it as live. The DELETE below is what makes it single-use, and
	// under REPEATABLE READ a plain SELECT is a non-locking snapshot read, so
	// without the lock both transactions would pass every check and the second
	// would fail late, on the identity insert, having already run a cascade.
	var pending pendingLink
	err = tx.QueryRowContext(ctx,
		"SELECT granted_subject, nonce_hash, expires FROM pending_link WHERE token = ? FOR UPDATE;", token).
		Scan(&pending.grantedSubject, &pending.nonceHash, &pending.expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLinkUnknown
	}
	if err != nil {
		return nil, fmt.Errorf("reading the pending link: %w", err)
	}

	// Consumed here, inside the transaction, so a refusal below rolls the
	// deletion back and leaves the token usable. That is deliberate: single-use
	// means a *successful* redemption spends it, and burning it on "you still
	// have recipes in this account" would make an explanatory message into a
	// dead end.
	if _, err := tx.ExecContext(ctx, "DELETE FROM pending_link WHERE token = ?;", token); err != nil {
		return nil, fmt.Errorf("consuming the pending link: %w", err)
	}

	if err := checkLink(pending, targetSubject, nonce, time.Now()); err != nil {
		return nil, err
	}

	sourceUserID, err := CanonicalUserID(ctx, tx, pending.grantedSubject)
	if errors.Is(err, ErrUnknownSubject) {
		return nil, ErrLinkSourceUnreachable
	}
	if err != nil {
		return nil, err
	}

	targetUserID, err := CanonicalUserID(ctx, tx, targetSubject)
	if err != nil {
		// Including ErrUnknownSubject, which would mean the caller signed in
		// with a provider they have never used here. Not a link, and not
		// something to invent an account for - POST /user is what creates
		// people, and it has already run by the time this page loads.
		return nil, fmt.Errorf("resolving the account being linked to: %w", err)
	}

	if sourceUserID == targetUserID {
		return nil, ErrLinkAlreadyLinked
	}

	source, err := linkSource(ctx, tx, sourceUserID)
	if err != nil {
		return nil, err
	}

	// **The subject being granted access comes from the row, never from the
	// request.** There is no way to spell a completion that links an identity
	// other than the one the token was issued for - which is what stops a stolen
	// token being pointed anywhere useful even by somebody who also has its
	// nonce.
	if err := applyLink(ctx, tx, source, pending.grantedSubject, targetUserID); err != nil {
		return nil, err
	}

	outcome := &LinkOutcome{
		LinkedSubject: pending.grantedSubject,
		Provider:      ProviderName(pending.grantedSubject),
	}
	// The surviving person, read inside the same transaction that just erased
	// the other one. `email` is nullable (migrations/044 normalises blanks to
	// NULL), and a missing address is not a failure - it only means the
	// notification has nowhere to go.
	var name, address sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT name, email FROM user WHERE id = ?;", targetUserID).
		Scan(&name, &address); err != nil {
		return nil, fmt.Errorf("reading the surviving user: %w", err)
	}
	outcome.Name = name.String
	outcome.Email = address.String

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("committing the link: %w", err)
	}
	return outcome, nil
}

// pendingLink is one `pending_link` row, as read back at completion.
//
// A type rather than three locals so that checkLink below cannot be called with
// the two subjects the wrong way round. That transposition is the one mistake
// here the compiler would otherwise wave through, and it is not a small one: it
// disarms the same-identity refusal completely while every test that drives the
// pieces separately goes on passing.
type pendingLink struct {
	// grantedSubject is the identity that will *gain* access, named by whoever
	// started the link. See migrations/046 for why the column is not just
	// `subject`.
	grantedSubject string
	nonceHash      string
	expires        time.Time
}

// checkLink is the whole refusal policy, with no database in it.
//
// Held apart for the reason otherMembersQuery and hashInvites are: this is the
// part with the reasoning in it, every branch of it is a security property, and
// reaching them through *sql.Row - which has no exported constructor - would
// mean a live database for what is really a table of five conditions.
//
// The order is not arbitrary. Expiry and the nonce come before anything that
// says a word about the identities involved, so a caller holding a token but not
// its nonce learns nothing about whose it is.
func checkLink(pending pendingLink, targetSubject, nonce string, now time.Time) error {
	if !now.Before(pending.expires) {
		return ErrLinkExpired
	}

	// Constant time, on the digests. The comparison is of two hex strings of
	// equal length, so the timing signal is small - but it is a secret
	// comparison on an authorisation path, and the cheap version of this is
	// also the correct one.
	if subtle.ConstantTimeCompare([]byte(pending.nonceHash), []byte(hashNonce(nonce))) != 1 {
		return ErrLinkNonceMismatch
	}

	// They came back with the provider they were already using. The spec's
	// accepted weakness is that we cannot tell somebody which provider they
	// originally signed up with - answering that would turn this into an
	// account-enumeration oracle - so guessing is the intended behaviour, and
	// this is what makes a wrong guess legible rather than a silent no-op.
	if pending.grantedSubject == targetSubject {
		return ErrLinkSameIdentity
	}

	return nil
}

// abandonedAccount is the Account a completed link leaves behind, resolved
// before anything is deleted.
type abandonedAccount struct {
	userID      string
	accountID   int
	emailDigest string
	// soleMember is the same decision DeleteAccount makes, taken the same way -
	// by counting the *other* members - because deleteAccountTx branches on it
	// and getting it wrong in the other direction deletes a co-member's recipes.
	soleMember bool
	// recipes is what decides whether the link is allowed at all.
	recipes int
}

// linkSource loads everything applyLink needs about the Account being abandoned.
//
// **Read before anything is written**, because the cascade is about to destroy
// the rows holding it - the same ordering constraint the deletion sequence has
// for the address it hands to SendGrid, for the same reason.
func linkSource(ctx context.Context, tx *sql.Tx, sourceUserID string) (abandonedAccount, error) {
	var source abandonedAccount
	source.userID = sourceUserID

	var address sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT email FROM user WHERE id = ?;", sourceUserID).Scan(&address); err != nil {
		return source, fmt.Errorf("reading the abandoned user: %w", err)
	}
	// The digest of "" is a perfectly good digest and matches no real invite,
	// which is the right answer for a user with no address on file.
	source.emailDigest = HashEmail(address.String)

	// The Account they can currently reach. **Refused rather than worked
	// around when there isn't one**, and that is a considered call rather than
	// an unhandled case: every alternative ends in the orphaned `account` row
	// this whole section exists to avoid. Skipping the cascade would strand
	// their rows; running it with no account id would delete every membership
	// they hold - including a disabled one pointing at some other Account -
	// and leave that Account with no reachable member.
	//
	// It is not reachable from the flow. The person starting a link is signed
	// in and using the app, which means an enabled membership; the only way to
	// hold none is to be sitting between account deletion's soft gate and its
	// cascade, and nothing offers this button there.
	if err := tx.QueryRowContext(ctx,
		"SELECT account_id FROM account_user WHERE user_id = ? AND enabled = true;", sourceUserID).
		Scan(&source.accountID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return source, ErrLinkSourceUnreachable
		}
		return source, fmt.Errorf("resolving the abandoned account: %w", err)
	}

	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM recipe WHERE account_id = ?;", source.accountID).Scan(&source.recipes); err != nil {
		return source, fmt.Errorf("counting the abandoned account's recipes: %w", err)
	}

	others, err := OtherAccountMembers(ctx, tx, source.accountID, sourceUserID)
	if err != nil {
		return source, err
	}
	source.soleMember = others == 0

	return source, nil
}

// applyLink erases the abandoned Account and grants its subject access to the
// surviving one.
//
// **The refusal comes first, and it is the point of the whole section.** By this
// stage the person already has a complete account: `user`, `user_identity`,
// `account`, `account_user`, a `ga_account_uuid`, a consent record and possibly
// a welcome email logged in `email_send`. Linking creates none of that - it
// *abandons* it, because the subject stops pointing at it and nothing can ever
// reach it again. An `account` row with no reachable member is precisely the
// state OtherAccountMembers and the deletion cascade were written to avoid, so
// leaving one behind means seeding the database with the shape the last round of
// work spent its time keeping out.
//
// Merging two populated accounts is a different and much larger problem -
// duplicate recipes, two shopping lists, two sets of invites, the Global
// Catalog's ingredient lines - and it is not what anybody in this situation is
// asking for. An empty library is the first thing you notice, so the population
// who add recipes before noticing is small; they get a clear message and a
// support address.
//
// **deleteAccountTx, not DeleteUserAndAccount.** This is the trap in the whole
// design, and the names invite it: DeleteUserAndAccount is the five-step erasure
// sequence, and three of its steps are actively wrong here. It sends a
// deletion-confirmation email to somebody who did not delete anything; it erases
// the SendGrid recipient for that address; and it **deletes the Auth0
// identity** - which is the very subject being linked, so the link would
// complete by destroying the login it had just granted. What is wanted is the
// inner cascade: the database rows and nothing external.
//
// The spec asks for "a narrow exported entry point" for that cascade, on the
// reasoning that it is unexported. It needs none, because this lives in the same
// package - and the transaction has to, since the erase and the grant are one
// atomic act. The rule the export was there to enforce is stated above instead.
func applyLink(ctx context.Context, tx execer, source abandonedAccount, subject, targetUserID string) error {
	if source.recipes > 0 {
		return ErrLinkSourceHasRecipes
	}

	if err := deleteAccountTx(ctx, tx, source.userID, source.accountID, source.emailDigest, source.soleMember); err != nil {
		return err
	}

	// After the cascade, never before: deleteAccountTx deletes
	// `user_identity WHERE user_id = <abandoned user>`, and `subject` is the
	// primary key of one of those very rows. Inserting first would be a
	// duplicate key, and reordering the cascade to suit this would be worse -
	// the row has to go, because it points at a user that is about to.
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO user_identity (subject, user_id) VALUES (?, ?);", subject, targetUserID); err != nil {
		return fmt.Errorf("granting the new sign-in access to the account: %w", err)
	}
	return nil
}
