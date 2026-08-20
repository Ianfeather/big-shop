package lifecycle

import (
	"testing"
	"time"
)

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("loading %s: %v", name, err)
	}
	return loc
}

// signedUpAt builds a Candidate who signed up at the given local time, stored
// as UTC the way the MySQL driver hands it back.
func signedUpAt(t *testing.T, zone string, local time.Time, sent ...Kind) Candidate {
	t.Helper()
	already := map[Kind]bool{}
	for _, k := range sent {
		already[k] = true
	}
	return Candidate{
		UserID:    "u1",
		Email:     "u1@example.com",
		Name:      "Test",
		Timezone:  zone,
		CreatedAt: local.UTC(),
		Sent:      already,
	}
}

// The whole point of the send hour: mail arrives mid-morning where the
// recipient is, not where the server is.
func TestDueOnlyAtTenLocal(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	signup := time.Date(2026, 9, 1, 9, 0, 0, 0, london)
	candidate := signedUpAt(t, "Europe/London", signup, KindWelcome)

	for hour := 0; hour < 24; hour++ {
		now := time.Date(2026, 9, 4, hour, 30, 0, 0, london)
		got, ok := due(candidate, now)
		if hour == sendHour {
			if !ok {
				t.Errorf("hour %02d: nothing due, expected the tips email", hour)
			} else if got.Kind != KindTips {
				t.Errorf("hour %02d: due %s, want %s", hour, got.Kind, KindTips)
			}
		} else if ok {
			t.Errorf("hour %02d: %s was due outside the send hour", hour, got.Kind)
		}
	}
}

// Two users in different zones are due at the same local hour, which is a
// different absolute instant - the reason the ticker runs hourly rather than
// once a day.
func TestDueFollowsTheRecipientsZone(t *testing.T) {
	tokyo := mustLoad(t, "Asia/Tokyo")
	london := mustLoad(t, "Europe/London")

	// 10:00 in Tokyo on 4 September 2026 is 02:00 in London.
	instant := time.Date(2026, 9, 4, 10, 0, 0, 0, tokyo)

	inTokyo := signedUpAt(t, "Asia/Tokyo", time.Date(2026, 9, 1, 9, 0, 0, 0, tokyo), KindWelcome)
	inLondon := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london), KindWelcome)

	if _, ok := due(inTokyo, instant); !ok {
		t.Error("the Tokyo user was not due at 10:00 Tokyo time")
	}
	if _, ok := due(inLondon, instant); ok {
		t.Error("the London user was due at 02:00 their time")
	}
}

// An absent zone must not mean an absent email.
func TestDueFallsBackWhenTheZoneIsUnknown(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "", time.Date(2026, 9, 1, 9, 0, 0, 0, london), KindWelcome)

	now := time.Date(2026, 9, 4, 10, 30, 0, 0, london)
	got, ok := due(candidate, now)
	if !ok {
		t.Fatal("a user with no timezone was never due; they should fall back to Europe/London")
	}
	if got.Kind != KindTips {
		t.Errorf("due %s, want %s", got.Kind, KindTips)
	}
}

// A zone that will not load must not abort the user - one bad row would
// otherwise take out the whole tick for everybody.
func TestDueFallsBackWhenTheZoneIsUnloadable(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "Neptune/Deep_Space", time.Date(2026, 9, 1, 9, 0, 0, 0, london), KindWelcome)

	now := time.Date(2026, 9, 4, 10, 30, 0, 0, london)
	if _, ok := due(candidate, now); !ok {
		t.Error("a user with an unloadable timezone was never due; they should fall back")
	}
}

// **The guard.** Without it, a week-long outage means the recovery tick finds a
// user due for tips, recipes and feedback at once and sends all three within a
// second - the likeliest route to a spam report this design has.
func TestAtMostOneEmailPerTick(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	// Signed up 20 days ago and never sent anything: every email in the
	// sequence is overdue simultaneously.
	candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london))
	now := time.Date(2026, 9, 21, 10, 30, 0, 0, london)

	got, ok := due(candidate, now)
	if !ok {
		t.Fatal("nothing was due for a user overdue for everything")
	}
	// The earliest unsent one, so someone catching up reads them in order.
	if got.Kind != KindWelcome {
		t.Errorf("due %s, want the earliest unsent email %s", got.Kind, KindWelcome)
	}

	// And having sent it, the next tick offers exactly one more - not the rest.
	candidate.Sent[KindWelcome] = true
	got, ok = due(candidate, now)
	if !ok || got.Kind != KindTips {
		t.Errorf("second tick due %v (ok=%v), want %s", got.Kind, ok, KindTips)
	}
}

// Being due is >=, not ==. With email_send written only on success, that is
// what makes a missed send arrive late rather than never.
func TestAMissedSendArrivesLateRatherThanNever(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london), KindWelcome)

	// Day 3 came and went with nothing sent. Day 9 still offers tips.
	now := time.Date(2026, 9, 10, 10, 30, 0, 0, london)
	got, ok := due(candidate, now)
	if !ok {
		t.Fatal("a user who missed their day 3 email is never due again")
	}
	if got.Kind != KindTips {
		t.Errorf("due %s, want %s - the missed email, not the one for today", got.Kind, KindTips)
	}
}

func TestNothingIsDueBeforeItsDay(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london), KindWelcome)

	// Day 2: the tips email is not due until day 3.
	now := time.Date(2026, 9, 3, 10, 30, 0, 0, london)
	if got, ok := due(candidate, now); ok {
		t.Errorf("%s was due on day 2", got.Kind)
	}
}

func TestNothingIsDueOnceTheSequenceIsComplete(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london),
		KindWelcome, KindTips, KindRecipes, KindFeedback)

	now := time.Date(2026, 10, 1, 10, 30, 0, 0, london)
	if got, ok := due(candidate, now); ok {
		t.Errorf("%s was due after the whole sequence had been sent", got.Kind)
	}
}

// Every entry becomes due on exactly the day the spec's table says.
func TestSequenceDays(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	signup := time.Date(2026, 9, 1, 9, 0, 0, 0, london)

	want := map[Kind]int{KindWelcome: 0, KindTips: 3, KindRecipes: 8, KindFeedback: 14}
	if len(want) != len(Sequence) {
		t.Fatalf("the sequence has %d entries, this test knows about %d", len(Sequence), len(want))
	}

	var sent []Kind
	for _, entry := range Sequence {
		day, known := want[entry.Kind]
		if !known {
			t.Fatalf("unexpected email kind %q in the sequence", entry.Kind)
		}
		if entry.Day != day {
			t.Errorf("%s is due on day %d, want day %d", entry.Kind, entry.Day, day)
		}

		candidate := signedUpAt(t, "Europe/London", signup, sent...)

		// The day before: not yet.
		if day > 0 {
			eve := time.Date(2026, 9, 1+day-1, 10, 30, 0, 0, london)
			if got, ok := due(candidate, eve); ok && got.Kind == entry.Kind {
				t.Errorf("%s was due a day early", entry.Kind)
			}
		}

		// The welcome is the exception: it is Day 0 of the sequence but the
		// *ticker* does not offer it until day 1, because day 0 belongs to the
		// inline send on signup and offering both would race. See due().
		ticksFrom := day
		if entry.Kind == KindWelcome {
			ticksFrom = 1
		}

		onTheDay := time.Date(2026, 9, 1+ticksFrom, 10, 30, 0, 0, london)
		got, ok := due(candidate, onTheDay)
		if !ok || got.Kind != entry.Kind {
			t.Errorf("on day %d got %v (ok=%v), want %s", ticksFrom, got.Kind, ok, entry.Kind)
		}

		sent = append(sent, entry.Kind)
	}
}

// A calendar day is 23 or 25 hours across a DST boundary. Counting elapsed
// hours and dividing by 24 turns three days into 2.958, truncates to 2, and
// silently holds the email back a day for anyone whose sequence spans late
// March or late October.
func TestDaysSinceSignupSurvivesDaylightSaving(t *testing.T) {
	london := mustLoad(t, "Europe/London")

	t.Run("spring forward", func(t *testing.T) {
		// BST began on 29 March 2026; that day is 23 hours long.
		signup := time.Date(2026, 3, 27, 9, 0, 0, 0, london)
		now := time.Date(2026, 3, 30, 10, 30, 0, 0, london)
		if got := daysSinceSignup(signup.UTC(), now, london); got != 3 {
			t.Errorf("daysSinceSignup across the spring transition = %d, want 3", got)
		}
	})

	t.Run("fall back", func(t *testing.T) {
		// GMT resumed on 25 October 2026; that day is 25 hours long.
		signup := time.Date(2026, 10, 23, 9, 0, 0, 0, london)
		now := time.Date(2026, 10, 26, 10, 30, 0, 0, london)
		if got := daysSinceSignup(signup.UTC(), now, london); got != 3 {
			t.Errorf("daysSinceSignup across the autumn transition = %d, want 3", got)
		}
	})

	// The tips email really does arrive on day 3 across the boundary, not day 4.
	t.Run("the tips email is not delayed", func(t *testing.T) {
		candidate := signedUpAt(t, "Europe/London", time.Date(2026, 3, 27, 9, 0, 0, 0, london), KindWelcome)
		now := time.Date(2026, 3, 30, 10, 30, 0, 0, london)
		got, ok := due(candidate, now)
		if !ok || got.Kind != KindTips {
			t.Errorf("across the DST boundary got %v (ok=%v), want %s on day 3", got.Kind, ok, KindTips)
		}
	})
}

// Signup time of day must not shift which day an email lands on: "day 3" is the
// third morning, not seventy-two hours later.
func TestSignupTimeOfDayDoesNotShiftTheSchedule(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	now := time.Date(2026, 9, 4, 10, 30, 0, 0, london)

	for _, hour := range []int{0, 6, 12, 23} {
		candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, hour, 0, 0, 0, london), KindWelcome)
		got, ok := due(candidate, now)
		if !ok || got.Kind != KindTips {
			t.Errorf("signed up at %02d:00, got %v (ok=%v), want %s on day 3", hour, got.Kind, ok, KindTips)
		}
	}
}

func TestEmailFor(t *testing.T) {
	for _, entry := range Sequence {
		got, err := EmailFor(entry.Kind)
		if err != nil {
			t.Errorf("EmailFor(%s) returned an error: %v", entry.Kind, err)
		}
		if got.Template == "" || got.Subject == "" {
			t.Errorf("%s is missing a subject or template: %+v", entry.Kind, got)
		}
	}
	if _, err := EmailFor("nonsense"); err == nil {
		t.Error("EmailFor on an unknown kind returned no error")
	}
}

// The guard that per-tick alone does not give you. Start() runs a tick on boot
// as well as hourly, so a restart during the send hour puts two ticks inside
// the same 10:00-10:59 window - and a crash loop puts many. Without this, a
// user overdue for the whole sequence receives it in a burst, which is exactly
// the spam report specs/email.md warns about.
func TestAtMostOneEmailPerDay(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	candidate := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london))

	first := time.Date(2026, 9, 21, 10, 30, 0, 0, london)
	got, ok := due(candidate, first)
	if !ok || got.Kind != KindWelcome {
		t.Fatalf("first tick got %v (ok=%v), want %s", got.Kind, ok, KindWelcome)
	}

	// It was sent, so record it the way Run would.
	candidate.Sent[got.Kind] = true
	candidate.LastSentAt = first

	// A second tick fifteen minutes later - the same send hour, a restarted
	// process - must find nothing, even though tips is long overdue.
	later := time.Date(2026, 9, 21, 10, 45, 0, 0, london)
	if got, ok := due(candidate, later); ok {
		t.Errorf("%s was sent %v after the previous email, in the same send hour", got.Kind, later.Sub(first))
	}

	// The next day it resumes.
	tomorrow := time.Date(2026, 9, 22, 10, 30, 0, 0, london)
	got, ok = due(candidate, tomorrow)
	if !ok || got.Kind != KindTips {
		t.Errorf("next day got %v (ok=%v), want %s", got.Kind, ok, KindTips)
	}
}

// The guard is on the recipient's calendar day, so it must not be fooled by a
// send that was "yesterday" in UTC but "today" where they are.
func TestTheOnePerDayGuardUsesTheRecipientsDay(t *testing.T) {
	tokyo := mustLoad(t, "Asia/Tokyo")
	candidate := signedUpAt(t, "Asia/Tokyo", time.Date(2026, 9, 1, 9, 0, 0, 0, tokyo))

	// 10:30 in Tokyo on 21 September is 01:30 UTC on the same date.
	first := time.Date(2026, 9, 21, 10, 30, 0, 0, tokyo)
	candidate.Sent[KindWelcome] = true
	candidate.LastSentAt = first.UTC()

	// Still 21 September in Tokyo, so still nothing due.
	later := time.Date(2026, 9, 21, 10, 45, 0, 0, tokyo)
	if got, ok := due(candidate, later); ok {
		t.Errorf("%s was due on the same Tokyo day as the previous send", got.Kind)
	}
}

// A nonsense created_at must not silently remove a user from the sequence
// forever. The zero time is what the MySQL driver yields for a 0000-00-00
// datetime, and subtracting it as a time.Duration saturates at ±292 years and
// then overflows when the half-day is added - giving a days count of -106751,
// so due() returned false on every tick, permanently, with nothing logged.
// A skipped email is unrecoverable in a way a delayed one is not.
func TestDaysSinceSignupDoesNotOverflowOnAbsurdDates(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	now := time.Date(2026, 9, 21, 10, 30, 0, 0, london)

	t.Run("the zero time gives the honest answer, not a saturated one", func(t *testing.T) {
		got := daysSinceSignup(time.Time{}, now, london)
		// Year 1 to 2026 is roughly 740,000 days. The bug made this -106751 -
		// a *negative* count, which read as "signed up in the future" and so
		// removed the user from the sequence permanently and silently.
		if got < 700000 {
			t.Errorf("daysSinceSignup(zero time) = %d; want a large positive count, not a saturated one", got)
		}
		// Such a row is excluded before it ever reaches here anyway:
		// loadCandidates requires created_at >= email_launch.launched_at, and
		// the zero time is comfortably before it. Belt and braces, because the
		// failure this guards is unrecoverable rather than merely wrong.
	})

	t.Run("a far-future signup is not due", func(t *testing.T) {
		future := time.Date(3000, 1, 1, 0, 0, 0, 0, london)
		candidate := signedUpAt(t, "Europe/London", future)
		if got, ok := due(candidate, now); ok {
			t.Errorf("%s was due for a user who signs up in the year 3000", got.Kind)
		}
	})

	t.Run("a very old signup is still due", func(t *testing.T) {
		old := time.Date(1970, 1, 2, 9, 0, 0, 0, london)
		candidate := signedUpAt(t, "Europe/London", old)
		got, ok := due(candidate, now)
		if !ok || got.Kind != KindWelcome {
			t.Errorf("got %v (ok=%v), want %s for a very old signup", got.Kind, ok, KindWelcome)
		}
	})
}

// The welcome is sent inline on signup, so the ticker must not also offer it on
// the signup day. A signup during the recipient's 10:00 hour can land inside a
// tick that loaded its candidates before the inline send finished; with both
// paths live on day 0, both would send. Together with ClaimSend on the inline
// side, this makes a duplicate welcome impossible rather than merely unlikely.
func TestTheTickerLeavesTheWelcomeAloneOnTheSignupDay(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	signup := time.Date(2026, 9, 1, 9, 0, 0, 0, london)
	candidate := signedUpAt(t, "Europe/London", signup)

	// Day 0, in the send hour, welcome not yet recorded: the inline send owns
	// this, so the ticker must offer nothing at all.
	sameDay := time.Date(2026, 9, 1, 10, 30, 0, 0, london)
	if got, ok := due(candidate, sameDay); ok {
		t.Errorf("the ticker offered %s on the signup day; the inline send owns day 0", got.Kind)
	}

	// The next day it takes over, which is the retry specs/email.md describes.
	nextDay := time.Date(2026, 9, 2, 10, 30, 0, 0, london)
	got, ok := due(candidate, nextDay)
	if !ok || got.Kind != KindWelcome {
		t.Errorf("on day 1 got %v (ok=%v), want the ticker to retry %s", got.Kind, ok, KindWelcome)
	}
}
