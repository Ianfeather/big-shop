package lifecycle

import (
	"context"
	"database/sql"
	"log"
	"time"

	"recipes/internal/pkg/service/email"
)

// tickInterval is how often the scheduler wakes up.
//
// Hourly rather than daily because sends are at 10:00 in the *recipient's*
// timezone, so the ticker has to wake often enough to catch every zone's 10:00.
// Exactly one hour matters: it guarantees precisely one tick lands inside each
// day's 10:00-10:59 window per zone, whatever time the process happened to
// start.
const tickInterval = time.Hour

// Sender is the slice of the email package the scheduler uses.
//
// An interface only so tests can observe what would be sent without a SendGrid
// key or a network - the same reason app.cachePurger exists. The bool is
// load-bearing rather than decorative: it distinguishes "delivered" from
// "declined to send because nothing is configured", and only the first may
// write an email_send row.
type Sender interface {
	SendLifecycle(ctx context.Context, to email.Recipient, subject, template string, data any) (bool, error)
}

// sendGridSender is the real one.
type sendGridSender struct{}

func (sendGridSender) SendLifecycle(ctx context.Context, to email.Recipient, subject, template string, data any) (bool, error) {
	return email.SendLifecycle(ctx, to, subject, template, data)
}

// TemplateData is what an onboarding template renders against.
//
// A single shape for all four rather than one per email, because they want the
// same things and a template that ignores a field costs nothing. Name is
// frequently empty - it is whatever Auth0 gave us - so templates must not
// assume it.
type TemplateData struct {
	Name string
	// Campaign is the utm_campaign value for links in this email, so attribution
	// is per-email without any template hardcoding its own name. Campaign-level
	// only: **no user or account identifier ever goes in a link**, because that
	// would rebuild in a third party's logs exactly the identifier linkage
	// specs/account-deletion.md spends its GA4 section removing.
	Campaign string
}

// Start runs the scheduler for the life of the process.
//
// **Called from the serve path only**, never from the Lambda handler, which
// would start a ticker per invocation - hundreds of them, each outliving
// nothing and each racing the others. There is exactly one always-on machine
// (fly.toml's auto_stop_machines = false, chosen so cold starts could not
// happen), so there is one ticker and no leader election: the entire
// distributed-systems problem is absent by construction rather than by care. If
// that ever stops being true, email_send's primary key is what stops a second
// machine double-sending.
//
// Runs once immediately and then hourly. The immediate run is safe for the same
// reason re-running by hand is safe - a duplicate is a primary key violation,
// not a second email - and it means a restart during the send hour still
// delivers that hour's mail rather than waiting until tomorrow.
func Start(ctx context.Context, db *sql.DB) {
	go func() {
		Run(ctx, db, sendGridSender{}, time.Now())

		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				Run(ctx, db, sendGridSender{}, now)
			}
		}
	}()
}

// Run performs one tick: work out who is due, and send each of them one email.
//
// Never returns an error, and that is deliberate. A tick is a background sweep
// over many users; one bad row, one unloadable template or one SendGrid refusal
// must not stop the other ninety-nine from getting their mail. Everything is
// logged and the tick carries on, and because nothing is recorded unless it was
// sent, whatever failed is retried on the next tick.
//
// `now` is a parameter rather than read from the clock inside, so tests can
// place the tick at a precise local hour on a chosen date.
func Run(ctx context.Context, db *sql.DB, sender Sender, now time.Time) {
	candidates, err := loadCandidates(ctx, db)
	if err != nil {
		log.Printf("lifecycle: could not load candidates: %v", err)
		return
	}

	for _, candidate := range candidates {
		next, ok := due(candidate, now)
		if !ok {
			continue
		}

		sent, err := sender.SendLifecycle(ctx,
			email.Recipient{Name: candidate.Name, Address: candidate.Email},
			next.Subject,
			next.Template,
			TemplateData{Name: candidate.Name, Campaign: string(next.Kind)},
		)
		if err != nil {
			log.Printf("lifecycle: sending %s to %s failed: %v", next.Kind, candidate.UserID, err)
			continue
		}
		if !sent {
			// Nothing configured - no API key, or no unsubscribe group. Not a
			// fault, and specifically not something to record: leaving the send
			// log untouched is what makes the whole sequence begin correctly
			// the moment the configuration lands, rather than having quietly
			// marked everyone as already mailed. The email package logs the
			// reason once per process, so this stays silent.
			continue
		}

		if err := RecordSend(ctx, db, candidate.UserID, next.Kind, now); err != nil {
			// The email has already gone. Failing to record it means it will be
			// sent again on the next tick, which is the one duplicate this
			// design cannot rule out - so it is logged loudly rather than
			// swallowed.
			log.Printf("lifecycle: SENT %s to %s but could not record it, it may be sent again: %v",
				next.Kind, candidate.UserID, err)
			continue
		}

		log.Printf("lifecycle: sent %s to %s", next.Kind, candidate.UserID)
	}
}
