package email

import (
	"context"
	"fmt"
	"log"
	"time"
)

// This file is the transactional half of the email programme: the emails Big
// Shop sends because the recipient just did something, as opposed to the
// scheduled onboarding sequence in internal/pkg/lifecycle.
//
// **It exists to state one rule mechanically, because stating it in prose did
// not work.** specs/completed/transactional-email.md:
//
//	A transactional send must never fail the action that caused it, and must
//	never delay it.
//
// The codebase already believed that and enforced it in exactly one of the two
// places it applied. app.sendWelcomeEmail goes to considerable trouble to obey
// it - background goroutine, WithoutCancel, bounded timeout - while
// app.inviteUser sent inline on the request's own context and turned any error
// into a 400, on a request whose Invite row had already been written and
// survived. The inviter was told their invite failed; it had not.
//
// So the rule lives in SendTransactionalAsync below rather than in a comment,
// and every transactional send goes through it. A future email cannot
// reintroduce the bug by forgetting, because the helper gives its caller
// nothing to fail on: it returns nothing at all.

// Kind identifies one transactional email.
//
// Unlike lifecycle.Kind these are not persisted anywhere - there is no send log
// on this side (one writer, no ticker, so no double-send race to protect
// against) - so renaming one is a code change and nothing more.
type Kind string

const (
	KindInvite         Kind = "invite"
	KindInviteAccepted Kind = "invite-accepted"
	KindInviteRejected Kind = "invite-rejected"
	KindAccountDeleted Kind = "account-deleted"
)

// String makes a Kind print as itself in log lines and errors.
func (k Kind) String() string { return string(k) }

// Email is one entry in the transactional family.
//
// **Deliberately not merged with lifecycle.Email**, though the shapes nearly
// match. That type carries Day, which is meaningless for an email caused by a
// request rather than by a date; and the two families differ on the property
// that matters most, the unsubscribe group. SendLifecycle and SendTransactional
// are two functions rather than one with a flag precisely so there is no way to
// send a lifecycle email down the path that skips the unsubscribe - and one
// registry spanning both would hand that mistake back.
type Email struct {
	Kind Kind
	// Subject is what lands in the inbox. Here rather than in the template so
	// every subject in the family is readable in one place, matching
	// lifecycle.Email.
	Subject string
	// Template names the file in this package's embedded templates directory.
	Template string
}

// Family is every transactional email Big Shop sends.
//
// Three of the four did not exist before specs/completed/transactional-email.md; the
// fourth, the invite, had been broken since the API Gateway stack its link
// pointed at was decommissioned.
var Family = []Email{
	{
		Kind:     KindInvite,
		Subject:  "You have been invited to join a Big Shop Account",
		Template: "invite",
	},
	{
		Kind:     KindInviteAccepted,
		Subject:  "Your Big Shop invitation was accepted",
		Template: "invite-accepted",
	},
	{
		Kind:     KindInviteRejected,
		Subject:  "Your Big Shop invitation was not accepted",
		Template: "invite-rejected",
	},
	{
		Kind:     KindAccountDeleted,
		Subject:  "Your Big Shop account is being deleted",
		Template: "account-deleted",
	},
}

// EmailFor returns the family entry for a Kind.
func EmailFor(kind Kind) (Email, error) {
	for _, e := range Family {
		if e.Kind == kind {
			return e, nil
		}
	}
	return Email{}, fmt.Errorf("email: no such transactional kind %q", kind)
}

// The data each template renders against.
//
// **Exported, and that is the point of moving them here.** InviteData's shape
// existed three times before this file: app.inviteEmailData, which was
// unexported, and therefore inviteData in email_test.go and inviteSample in
// preview.go, both of which existed only because the first could not be
// imported. Three declarations of one shape, kept in step by hand, in a
// codebase where a field renamed on one side and not the other renders an empty
// string into a real email.
//
// They live beside the registry rather than beside their handlers because the
// template is what they are shaped by, and the template is here.
type (
	// InviteData renders templates/invite.html.
	InviteData struct {
		InviterName string
		Token       string
	}

	// InviteAcceptedData renders templates/invite-accepted.html, sent to the
	// inviter when somebody joins their Account.
	InviteAcceptedData struct {
		InviterName string
	}

	// InviteRejectedData renders templates/invite-rejected.html, sent to the
	// inviter when an invitation is declined.
	//
	// Carries no invitee identity, deliberately: see the template, and
	// specs/completed/transactional-email.md Phase 3 - the email's job is handing back the
	// ability to invite again, not reporting who said no.
	InviteRejectedData struct {
		InviterName string
	}

	// AccountDeletedData renders templates/account-deleted.html.
	AccountDeletedData struct {
		Name string
	}
)

// transactionalTimeout bounds a background send.
//
// Nothing waits on it, so without a bound an unresponsive SendGrid would hold a
// goroutine open for as long as it felt like. Matches app.welcomeTimeout, which
// is the same trade for the same reason.
const transactionalTimeout = 20 * time.Second

// SendTransactionalAsync sends one transactional email in the background,
// best-effort, and **returns nothing**.
//
// The empty return type is the whole design. A caller cannot fail on a value it
// was never given, so no handler can turn a send failure into a status code the
// way inviteUser did. Everything the rule requires is enforced here once:
//
//   - **context.WithoutCancel, not the request context.** This is the subtle
//     one, and app.sendWelcomeEmail's comment records how it was learned: the
//     request's context is cancelled the instant the response is written, so a
//     goroutine holding it has its HTTP call to SendGrid aborted almost
//     immediately - intermittently, depending on which won the race. Trace and
//     span context are preserved by WithoutCancel, so the send still appears
//     under the request that caused it.
//   - **A bounded timeout**, per transactionalTimeout above.
//   - **Failures are logged and swallowed.** There is nobody to return them to.
//
// Not shared with the lifecycle side, which claims a send-log row before
// sending so that the ticker and the login path cannot both mail the same
// person. Transactional email has exactly one writer - the request that caused
// it - so copying that would add a table and a failure mode for a race that
// cannot happen.
func SendTransactionalAsync(ctx context.Context, to Recipient, kind Kind, data any) {
	entry, err := EmailFor(kind)
	if err != nil {
		// A programming error rather than a runtime condition: the kind is
		// always a constant from this file. Logged rather than panicking,
		// because taking down a request that had already succeeded in order to
		// complain about an email is the exact failure this file exists to
		// prevent.
		log.Printf("transactional email: %v", err)
		return
	}

	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), transactionalTimeout)

	go func() {
		defer cancel()

		// The bool is deliberately ignored. A false with a nil error is the
		// ordinary unconfigured case - no API key, or no address on the
		// recipient - which this package already announces once per process;
		// logging it here instead would put a line in the output for every
		// invite sent on a laptop.
		if _, err := SendTransactional(sendCtx, to, entry.Subject, entry.Template, data); err != nil {
			log.Printf("transactional email %q was not sent: %v", kind, err)
		}
	}()
}
