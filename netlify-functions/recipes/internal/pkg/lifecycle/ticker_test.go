package lifecycle

import (
	"context"
	"errors"
	"testing"
	"time"

	"recipes/internal/pkg/service/email"
)

type recordedSend struct {
	userID   string
	kind     Kind
	sentAt   time.Time
	address  string
	subject  string
	template string
	data     any
}

// fakeStore stands in for the database, recording what a tick wrote.
type fakeStore struct {
	load      []Candidate
	loadErr   error
	recorded  []recordedSend
	recordErr error
}

func (f *fakeStore) candidates(context.Context) ([]Candidate, error) {
	return f.load, f.loadErr
}

func (f *fakeStore) record(_ context.Context, userID string, kind Kind, sentAt time.Time) error {
	if f.recordErr != nil {
		return f.recordErr
	}
	f.recorded = append(f.recorded, recordedSend{userID: userID, kind: kind, sentAt: sentAt})
	return nil
}

// fakeSender stands in for SendGrid.
type fakeSender struct {
	sent []recordedSend
	// result and err are what every call returns. A (false, nil) is the
	// unconfigured case, which is what every environment is until a key lands.
	result bool
	err    error
}

func (f *fakeSender) SendLifecycle(_ context.Context, to email.Recipient, subject, template string, data any) (bool, error) {
	f.sent = append(f.sent, recordedSend{
		address: to.Address, subject: subject, template: template, data: data,
	})
	return f.result, f.err
}

func londonCandidate(t *testing.T, id string, sent ...Kind) Candidate {
	t.Helper()
	london := mustLoad(t, "Europe/London")
	c := signedUpAt(t, "Europe/London", time.Date(2026, 9, 1, 9, 0, 0, 0, london), sent...)
	c.UserID = id
	c.Email = id + "@example.com"
	return c
}

func tickTime(t *testing.T) time.Time {
	t.Helper()
	return time.Date(2026, 9, 21, 10, 30, 0, 0, mustLoad(t, "Europe/London"))
}

// **The branch that matters most.** With nothing configured the sender declines,
// and a tick must write no send-log rows at all - so the sequence begins
// correctly the moment a key lands rather than having quietly marked everyone as
// already mailed. This is the state every environment is in today.
func TestRunRecordsNothingWhenTheSenderDeclines(t *testing.T) {
	st := &fakeStore{load: []Candidate{londonCandidate(t, "u1"), londonCandidate(t, "u2")}}
	sender := &fakeSender{result: false}

	run(context.Background(), st, sender, tickTime(t))

	if len(sender.sent) != 2 {
		t.Errorf("attempted %d sends, want 2", len(sender.sent))
	}
	if len(st.recorded) != 0 {
		t.Errorf("wrote %d send-log rows after the sender declined; want none", len(st.recorded))
	}
}

// A refusal from SendGrid must not be recorded either, or the email is lost
// forever rather than retried on the next tick.
func TestRunRecordsNothingWhenTheSendFails(t *testing.T) {
	st := &fakeStore{load: []Candidate{londonCandidate(t, "u1")}}
	sender := &fakeSender{result: false, err: errors.New("sendgrid said no")}

	run(context.Background(), st, sender, tickTime(t))

	if len(st.recorded) != 0 {
		t.Errorf("wrote %d send-log rows after a failed send; want none", len(st.recorded))
	}
}

func TestRunRecordsASuccessfulSend(t *testing.T) {
	now := tickTime(t)
	st := &fakeStore{load: []Candidate{londonCandidate(t, "u1")}}
	sender := &fakeSender{result: true}

	run(context.Background(), st, sender, now)

	if len(st.recorded) != 1 {
		t.Fatalf("wrote %d send-log rows, want 1", len(st.recorded))
	}
	got := st.recorded[0]
	if got.userID != "u1" || got.kind != KindWelcome {
		t.Errorf("recorded %s for %s, want %s for u1", got.kind, got.userID, KindWelcome)
	}
	// The tick's instant, not the wall clock - it is what the per-day guard
	// compares against on the next tick.
	if !got.sentAt.Equal(now) {
		t.Errorf("recorded sent_at %v, want the tick time %v", got.sentAt, now)
	}
}

// One user failing must not starve the rest of the list. A tick is a background
// sweep, and an early return would mean one bad row silently withholding
// everybody else's mail.
func TestRunContinuesPastAFailure(t *testing.T) {
	st := &fakeStore{load: []Candidate{
		londonCandidate(t, "u1"),
		londonCandidate(t, "u2"),
		londonCandidate(t, "u3"),
	}}
	sender := &fakeSender{result: true}
	st.recordErr = nil

	run(context.Background(), st, sender, tickTime(t))

	if len(sender.sent) != 3 {
		t.Errorf("attempted %d sends, want all 3 candidates attempted", len(sender.sent))
	}
}

// A send that succeeded but could not be recorded is the one duplicate this
// design cannot rule out. It must not stop the tick.
func TestRunSurvivesAFailureToRecord(t *testing.T) {
	st := &fakeStore{
		load:      []Candidate{londonCandidate(t, "u1"), londonCandidate(t, "u2")},
		recordErr: errors.New("database is gone"),
	}
	sender := &fakeSender{result: true}

	run(context.Background(), st, sender, tickTime(t))

	if len(sender.sent) != 2 {
		t.Errorf("attempted %d sends, want 2 - a failed record must not starve the next user", len(sender.sent))
	}
}

func TestRunSurvivesAFailureToLoad(t *testing.T) {
	st := &fakeStore{loadErr: errors.New("database is gone")}
	sender := &fakeSender{result: true}

	// Nothing to assert but that it returns rather than panicking; a tick that
	// cannot read the database has nothing to do.
	run(context.Background(), st, sender, tickTime(t))

	if len(sender.sent) != 0 {
		t.Errorf("sent %d emails despite being unable to load candidates", len(sender.sent))
	}
}

// Nobody due means nothing attempted - the ordinary state of almost every tick.
func TestRunSendsNothingOutsideTheSendHour(t *testing.T) {
	london := mustLoad(t, "Europe/London")
	st := &fakeStore{load: []Candidate{londonCandidate(t, "u1")}}
	sender := &fakeSender{result: true}

	run(context.Background(), st, sender, time.Date(2026, 9, 21, 3, 30, 0, 0, london))

	if len(sender.sent) != 0 || len(st.recorded) != 0 {
		t.Errorf("sent %d and recorded %d at 03:30 local; want nothing", len(sender.sent), len(st.recorded))
	}
}

// What the sender is actually handed, including the campaign name that becomes
// utm_campaign in the template's links.
func TestRunPassesTheRightMessage(t *testing.T) {
	candidate := londonCandidate(t, "u1", KindWelcome)
	candidate.Name = "Ada"
	st := &fakeStore{load: []Candidate{candidate}}
	sender := &fakeSender{result: true}

	run(context.Background(), st, sender, tickTime(t))

	if len(sender.sent) != 1 {
		t.Fatalf("attempted %d sends, want 1", len(sender.sent))
	}
	got := sender.sent[0]
	if got.address != "u1@example.com" {
		t.Errorf("sent to %q", got.address)
	}
	if got.template != "tips" {
		t.Errorf("template %q, want tips", got.template)
	}
	data, ok := got.data.(TemplateData)
	if !ok {
		t.Fatalf("template data is %T, want TemplateData", got.data)
	}
	if data.Name != "Ada" {
		t.Errorf("Name = %q, want Ada", data.Name)
	}
	// Campaign-level attribution only, and it must be the kind - never anything
	// identifying the user or their account.
	if data.Campaign != string(KindTips) {
		t.Errorf("Campaign = %q, want %q", data.Campaign, KindTips)
	}
}
