// Package lifecycle is the onboarding email sequence: which emails exist, when
// each is due, and the ticker that sends them.
//
// Deliberately separate from internal/pkg/service/email, which knows how to
// render and hand a message to SendGrid and nothing else. This package knows
// who should get what and when, and touches the database to find out. Keeping
// the two apart is what lets the scheduling rules - the part with all the
// arithmetic and all the edge cases - be tested as pure functions with no
// database and no network.
//
// The design decision underneath all of it, argued at length in
// specs/email.md: **there is no behavioural targeting.** No activation ladder,
// no per-Account state evaluation, no qualification query, no branching. A
// fixed four-email sequence on days-since-signup goes to everyone. The reason
// is false positives - any threshold cheap enough to measure is reachable by
// somebody poking at the product without meaning it, and crossing it would mark
// them activated and stop the sequence, producing silence for exactly the
// people most in need of the next email. The constraint this imposes lands on
// the copy rather than the code: every email must be worth reading regardless
// of what the Account holds, because nothing checks.
package lifecycle

import (
	"fmt"
	"time"
)

// Kind identifies one email in the sequence. The string value is what is stored
// in email_send.kind, so these are not renameable without a migration.
type Kind string

const (
	KindWelcome  Kind = "welcome"
	KindTips     Kind = "tips"
	KindRecipes  Kind = "recipes"
	KindFeedback Kind = "feedback"
)

// sendHour is the local hour every scheduled email goes out at.
//
// Mid-morning: past the commute-and-triage window, so the mail is not buried
// under the overnight pile, and a grocery app is a daytime thought. It is the
// reason the ticker runs hourly rather than daily - 10:00 happens twenty-four
// times a day across the world's zones, and the ticker has to wake up often
// enough to catch each one.
const sendHour = 10

// fallbackZone is used for a User whose timezone was never captured.
//
// Every row predating migrations/035 has none, as does anyone whose browser
// declined to report one. service.normaliseTimezone guarantees anything that
// *is* stored is loadable, so this is the fallback for absent, not for
// malformed.
const fallbackZone = "Europe/London"

// Email is one entry in the sequence.
type Email struct {
	Kind Kind
	// Day is how many whole days after signup this becomes due, counted in the
	// recipient's own timezone.
	Day int
	// Subject is what lands in the inbox. Here rather than in the template
	// because the template renders the body; a subject line is not part of the
	// HTML and there is nowhere sensible to put it there.
	Subject string
	// Template names the file in service/email's embedded templates directory.
	Template string
}

// Sequence is the whole programme, in order.
//
// **Order matters and is relied upon.** due() walks this list front to back and
// returns the first entry that is due and unsent, which is what makes someone
// who is behind - because a send failed, or because the API was down for a week
// - catch up in the order the emails were written to be read, one per day,
// rather than receiving three at once.
//
// Four rather than five or six, and a fortnight rather than three weeks. The
// risk knowingly accepted is that a single tips email becomes a feature list
// nobody finishes reading, which is a copy problem to solve in the writing
// rather than a reason to add a send.
var Sequence = []Email{
	{
		Kind: KindWelcome, Day: 0,
		Subject:  "Welcome to Big Shop",
		Template: "welcome",
	},
	{
		Kind: KindTips, Day: 3,
		Subject:  "Three things Big Shop does that are easy to miss",
		Template: "tips",
	},
	{
		Kind: KindRecipes, Day: 8,
		Subject:  "A few recipes worth cooking this week",
		Template: "recipes",
	},
	{
		Kind: KindFeedback, Day: 14,
		Subject:  "How are you finding Big Shop?",
		Template: "feedback",
	},
}

// Candidate is one User the scheduler is considering, with everything needed to
// decide what to send them.
type Candidate struct {
	UserID   string
	Email    string
	Name     string
	Timezone string
	// CreatedAt is when they signed up. Read back as UTC by the MySQL driver
	// (the DSN sets parseTime, and the driver's default location is UTC), and
	// converted into the recipient's zone before any day counting happens.
	CreatedAt time.Time
	// Sent is the set of kinds already recorded in email_send for this User.
	Sent map[Kind]bool
	// LastSentAt is the most recent email_send.sent_at for this User, or the
	// zero time if they have never been sent anything. See due()'s one-per-day
	// guard for why the set of kinds is not enough on its own.
	LastSentAt time.Time
}

// location resolves the recipient's timezone, falling back rather than failing.
//
// A zone that will not load cannot be allowed to abort anything: it would mean
// one bad row stopping the whole tick for everybody else. Falling back sends
// their mail at the wrong local hour, which is a far smaller problem than not
// sending it.
func (c Candidate) location() *time.Location {
	if c.Timezone != "" {
		if loc, err := time.LoadLocation(c.Timezone); err == nil {
			return loc
		}
	}
	loc, err := time.LoadLocation(fallbackZone)
	if err != nil {
		// Only reachable if the embedded timezone database is missing, which
		// main.go's `_ "time/tzdata"` import exists to prevent. UTC is wrong by
		// an hour for half the year and is still better than nil.
		return time.UTC
	}
	return loc
}

// daysSinceSignup counts whole calendar days between signup and now, in the
// recipient's own timezone.
//
// Calendar days rather than elapsed hours, because "day 3" means the third
// morning, not seventy-two hours. Both instants are floored to local midnight
// first, so the answer does not depend on what time of day they happened to
// sign up.
//
// The +12h before dividing is what makes this survive daylight saving. A
// calendar day is 23 or 25 hours long across a DST boundary, so a plain
// division by 24 turns three days into 2.958 and truncates it to 2 - which
// would silently hold the tips email back by a day for anyone whose sequence
// spans late March or late October. specs/email.md rejected storing a UTC
// offset instead of a zone name for the same reason, from the other direction.
func daysSinceSignup(createdAt, now time.Time, loc *time.Location) int {
	midnight := func(t time.Time) time.Time {
		t = t.In(loc)
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	}
	elapsed := midnight(now).Sub(midnight(createdAt))
	return int((elapsed + 12*time.Hour) / (24 * time.Hour))
}

// sameLocalDay reports whether two instants fall on the same calendar day in
// the given zone.
func sameLocalDay(a, b time.Time, loc *time.Location) bool {
	ay, am, ad := a.In(loc).Date()
	by, bm, bd := b.In(loc).Date()
	return ay == by && am == bm && ad == bd
}

// due returns the one email this Candidate should be sent right now, if any.
//
// **At most one, ever, per call.** specs/email.md is emphatic about this and it
// is the single most important line in this file: without it, an outage lasting
// a week means the recovery tick finds a user due for tips, recipes and
// feedback simultaneously and sends all three within a second of each other,
// which is the likeliest way this design produces a spam report. The guard is
// not a check - it is the shape of the function, which has no way to express
// more than one answer.
//
// Being due is `>=`, not `==`, on days-since-signup. Together with only writing
// email_send on a successful send, that is what makes the sequence self-heal: a
// failed send, an outage, or a deploy during the send hour does not skip an
// email, it arrives on the next day's tick.
func due(c Candidate, now time.Time) (Email, bool) {
	loc := c.location()
	if now.In(loc).Hour() != sendHour {
		return Email{}, false
	}

	// **One email per user per day, not merely one per tick.**
	//
	// Per-tick alone is not the guarantee it looks like. Start() runs a tick
	// immediately on boot as well as hourly, so two ticks can land inside the
	// same 10:00-10:59 window whenever the process restarts during it - a
	// deploy, a crash loop, or somebody re-running it by hand. Caught by
	// running the ticker against a real database rather than by the unit tests,
	// which only ever advance the clock by an hour: a user overdue for
	// everything received welcome at 10:30 and tips at 10:45, and a restart
	// loop would have marched them through the whole sequence in minutes.
	//
	// That is precisely the burst specs/email.md says is "the single most
	// likely way this design produces a spam report", so the guard is on the
	// thing that actually matters - the calendar day, in the recipient's own
	// zone - rather than on the tick that happens to be running.
	if !c.LastSentAt.IsZero() && sameLocalDay(c.LastSentAt, now, loc) {
		return Email{}, false
	}

	days := daysSinceSignup(c.CreatedAt, now, loc)

	for _, email := range Sequence {
		if c.Sent[email.Kind] {
			continue
		}
		if days >= email.Day {
			return email, true
		}
		// The sequence is ordered, so the first entry that is not yet due means
		// nothing later is due either. Returning rather than continuing is not
		// an optimisation: without it, someone on day 3 with an unsent welcome
		// would match tips as well, and which one arrived would depend on list
		// order rather than on anything deliberate.
		return Email{}, false
	}
	return Email{}, false
}

// String makes a Kind print as itself in log lines and errors.
func (k Kind) String() string { return string(k) }

// EmailFor returns the sequence entry for a Kind, which the send-test command
// needs to turn a --kind flag into a subject and a template.
func EmailFor(kind Kind) (Email, error) {
	for _, e := range Sequence {
		if e.Kind == kind {
			return e, nil
		}
	}
	return Email{}, fmt.Errorf("no such email kind %q", kind)
}
