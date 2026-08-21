package email

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestEmailForEveryKind(t *testing.T) {
	for _, entry := range Family {
		got, err := EmailFor(entry.Kind)
		if err != nil {
			t.Errorf("EmailFor(%q) returned an error: %v", entry.Kind, err)
			continue
		}
		if got != entry {
			t.Errorf("EmailFor(%q) = %+v, want %+v", entry.Kind, got, entry)
		}
	}
}

func TestEmailForUnknownKind(t *testing.T) {
	if _, err := EmailFor(Kind("not-an-email")); err == nil {
		t.Error("EmailFor did not report an unknown kind")
	}
}

// Every entry must carry a subject and a template, and no two may share a
// template. A copy-pasted entry that kept the previous one's template is the
// realistic mistake here, and it would send the wrong email under the right
// subject - which reads as correct in the code and is wrong in the inbox.
func TestFamilyEntriesAreWellFormed(t *testing.T) {
	seenKind := map[Kind]bool{}
	seenTemplate := map[string]bool{}
	for _, entry := range Family {
		if entry.Subject == "" {
			t.Errorf("%q has no subject", entry.Kind)
		}
		if entry.Template == "" {
			t.Errorf("%q has no template", entry.Kind)
		}
		if seenKind[entry.Kind] {
			t.Errorf("%q is registered twice", entry.Kind)
		}
		if seenTemplate[entry.Template] {
			t.Errorf("template %q is used by more than one kind", entry.Template)
		}
		seenKind[entry.Kind], seenTemplate[entry.Template] = true, true
	}
}

// The rule this whole file exists for: the helper hands the caller nothing to
// fail on, and does not wait for SendGrid before returning.
//
// Asserted by making the stub block for longer than the test is willing to
// wait: if SendTransactionalAsync were synchronous, it could not return before
// the release below, and the test would fail on the elapsed time rather than
// hanging forever.
func TestSendTransactionalAsyncDoesNotBlockTheCaller(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")

	release := make(chan struct{})
	arrived := make(chan struct{}, 1)
	withStubSendGrid(t, func(w http.ResponseWriter, r *http.Request) {
		arrived <- struct{}{}
		<-release
		w.WriteHeader(http.StatusAccepted)
	})
	defer close(release)

	start := time.Now()
	SendTransactionalAsync(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"},
		KindInvite, InviteData{InviterName: "Ada", Token: "t"})
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("SendTransactionalAsync blocked for %v; it must return immediately", elapsed)
	}

	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("the background send never reached SendGrid")
	}
}

// A cancelled request context must not cancel the send.
//
// This is the failure app.sendWelcomeEmail's comment records: the request's
// context is cancelled the instant the response is written, so a goroutine
// holding it has its SendGrid call aborted - intermittently, depending on which
// wins the race. context.WithoutCancel is what prevents it, and nothing else in
// the file would fail if it were removed.
func TestSendTransactionalAsyncSurvivesACancelledRequest(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")

	arrived := make(chan struct{}, 1)
	withStubSendGrid(t, func(w http.ResponseWriter, r *http.Request) {
		arrived <- struct{}{}
		w.WriteHeader(http.StatusAccepted)
	})

	ctx, cancel := context.WithCancel(context.Background())
	SendTransactionalAsync(ctx, Recipient{Name: "A", Address: "a@example.com"},
		KindInvite, InviteData{InviterName: "Ada", Token: "t"})
	// Cancel immediately, standing in for the response being written.
	cancel()

	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelling the request context killed the background send")
	}
}

// An unknown kind is a programming error, and it must still not take anything
// down - the request that caused it has already succeeded.
func TestSendTransactionalAsyncToleratesAnUnknownKind(t *testing.T) {
	SendTransactionalAsync(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, Kind("not-an-email"), nil)
}

// Every registered email must have a template that actually renders.
//
// The registry and the templates directory are two lists that have to agree,
// and nothing but this test makes them. A Kind registered against a template
// that does not exist fails at send time, inside a goroutine, on a path that
// deliberately swallows its errors - so the first sign would be an email that
// silently never arrives.
func TestEveryRegisteredEmailRenders(t *testing.T) {
	samples := map[Kind]any{
		KindInvite:         InviteData{InviterName: "Ada", Token: "t"},
		KindInviteAccepted: InviteAcceptedData{InviterName: "Ada"},
		KindInviteRejected: InviteRejectedData{InviterName: "Ada"},
		KindAccountDeleted: AccountDeletedData{Name: "Ada"},
	}

	for _, entry := range Family {
		sample, ok := samples[entry.Kind]
		if !ok {
			t.Errorf("%q is registered but this test has no sample data for it", entry.Kind)
			continue
		}
		// unsubscribable is false throughout: transactional mail carries no ASM
		// group, and TestTransactionalRenderHasNoUnsubscribeTag pins that.
		if _, err := Render(entry.Template, sample, false); err != nil {
			t.Errorf("%q does not render: %v", entry.Kind, err)
		}
	}
}
