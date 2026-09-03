package email

import (
	"context"
	"encoding/json"
	"flag"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// hrefPattern pulls the link targets out of rendered HTML.
var hrefPattern = regexp.MustCompile(`href="([^"]+)"`)

// queryKeys returns every query parameter name used by any link in the document.
//
// The rule being enforced is about URLs specifically, not about the words in the
// email - the prose can say "account" all it likes, but a URL carrying an
// account id is logged by every mail provider between here and the recipient.
func queryKeys(t *testing.T, html string) []string {
	t.Helper()
	var keys []string
	for _, match := range hrefPattern.FindAllStringSubmatch(html, -1) {
		raw := strings.ReplaceAll(match[1], "&amp;", "&")
		parsed, err := url.Parse(raw)
		if err != nil {
			// The SendGrid unsubscribe substitution tag is not a URL yet; it
			// becomes one at send time. Nothing to check.
			continue
		}
		for key := range parsed.Query() {
			keys = append(keys, key)
		}
	}
	return keys
}

// update rewrites the golden files instead of comparing against them:
//
//	go test ./internal/pkg/service/email -update
//
// The first golden-file test in this repository, so it also sets the
// convention: golden output lives in testdata/<name>.golden.html, is committed,
// and is reviewed in the pull request like any other file. That is the point of
// keeping email copy in the repo at all - a change to what a user is sent shows
// up as a diff somebody has to approve, which is exactly what SendGrid's
// template UI cannot offer.
var update = flag.Bool("update", false, "rewrite golden files")

// fixedSiteURL keeps rendered output independent of the environment the test
// runs in, so a golden file does not change depending on whether SITE_URL
// happens to be set.
const fixedSiteURL = "https://www.bigshop.life"

// lifecycleData mirrors lifecycle.TemplateData. Duplicated rather than imported
// because lifecycle imports this package, and depending on it back would be a
// cycle. The shapes are pinned together by TestLifecycleTemplatesRenderWithRealData
// over in the lifecycle package.
type lifecycleData struct {
	Name     string
	Campaign string
}

func TestRenderGolden(t *testing.T) {
	cases := []struct {
		name           string
		template       string
		data           any
		unsubscribable bool
	}{
		{
			name:           "invite",
			template:       "invite",
			data:           InviteData{InviterName: "Ian Feather", Token: "abc123"},
			unsubscribable: false,
		},
		{
			name:           "invite-accepted",
			template:       "invite-accepted",
			data:           InviteAcceptedData{InviterName: "Ian Feather"},
			unsubscribable: false,
		},
		{
			name:           "invite-rejected",
			template:       "invite-rejected",
			data:           InviteRejectedData{InviterName: "Ian Feather"},
			unsubscribable: false,
		},
		{
			name:           "account-deleted",
			template:       "account-deleted",
			data:           AccountDeletedData{Name: "Ian Feather"},
			unsubscribable: false,
		},
		{
			name:           "sign-in-added",
			template:       "sign-in-added",
			data:           SignInAddedData{Name: "Ian Feather", Provider: "Apple", When: "2 September 2026 at 14:05 UTC"},
			unsubscribable: false,
		},
		// The same email for a connection service.ProviderName has no name for.
		// Rendered separately because the fallback sentence is the whole reason
		// ProviderName returns "" rather than guessing: a raw Auth0 connection
		// name in a security notice is worse than a vaguer one, but only if the
		// vaguer one actually reads as English. That is reviewed here, not
		// assumed - the same reason welcome-no-name exists.
		{
			name:           "sign-in-added-unknown-provider",
			template:       "sign-in-added",
			data:           SignInAddedData{Name: "Ian Feather", When: "2 September 2026 at 14:05 UTC"},
			unsubscribable: false,
		},
		// The four onboarding emails. Unsubscribable, so each golden file also
		// pins that the footer link is present - the condition ADR-0010's whole
		// lawful basis rests on.
		{name: "welcome", template: "welcome", data: lifecycleData{Name: "Ada", Campaign: "welcome"}, unsubscribable: true},
		{name: "tips", template: "tips", data: lifecycleData{Name: "Ada", Campaign: "tips"}, unsubscribable: true},
		{name: "recipes", template: "recipes", data: lifecycleData{Name: "Ada", Campaign: "recipes"}, unsubscribable: true},
		{name: "feedback", template: "feedback", data: lifecycleData{Name: "Ada", Campaign: "feedback"}, unsubscribable: true},
		// Name is whatever Auth0 gave us, which is frequently nothing. Rendered
		// separately so the greeting's fallback is reviewed rather than assumed.
		{name: "welcome-no-name", template: "welcome", data: lifecycleData{Campaign: "welcome"}, unsubscribable: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_URL", fixedSiteURL)

			got, err := Render(tc.template, tc.data, tc.unsubscribable)
			if err != nil {
				t.Fatalf("Render(%q) returned an error: %v", tc.template, err)
			}

			path := filepath.Join("testdata", tc.name+".golden.html")
			if *update {
				if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
					t.Fatalf("writing golden file: %v", err)
				}
				return
			}

			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("reading golden file (run with -update to create it): %v", err)
			}
			if got != string(want) {
				t.Errorf("rendered %q does not match %s.\nRe-run with -update if the change is intended.\n\ngot:\n%s", tc.template, path, got)
			}
		})
	}
}

// The unsubscribe link is the condition ADR-0010's whole lawful basis rests on,
// and it is invisible in the Go code - it is one conditional block in a layout
// file that a copy edit could delete without anything else noticing. So it is
// asserted directly rather than only via the golden files.
func TestLifecycleRenderCarriesUnsubscribeTag(t *testing.T) {
	t.Setenv("SITE_URL", fixedSiteURL)

	html, err := Render("invite", InviteData{InviterName: "Ian", Token: "t"}, true)
	if err != nil {
		t.Fatalf("Render returned an error: %v", err)
	}

	// Verbatim, not escaped. The tag is literal text in layout.html precisely
	// so it survives: substituted in as data it would be percent-encoded by
	// html/template's URL normalizer into something SendGrid never rewrites,
	// and a template.URL would not save it - that skips the safety filter, not
	// the normalizer. The failure would be silent, an unsubscribe link leading
	// nowhere rather than an error anybody sees, which is why this is asserted
	// rather than left to the golden files.
	if !strings.Contains(html, string(unsubscribeTag)) {
		t.Errorf("lifecycle email does not contain the unsubscribe substitution tag %q", unsubscribeTag)
	}
}

func TestTransactionalRenderHasNoUnsubscribeTag(t *testing.T) {
	t.Setenv("SITE_URL", fixedSiteURL)

	html, err := Render("invite", InviteData{InviterName: "Ian", Token: "t"}, false)
	if err != nil {
		t.Fatalf("Render returned an error: %v", err)
	}

	if strings.Contains(html, string(unsubscribeTag)) {
		t.Error("transactional email contains an unsubscribe tag; it has no ASM group, so the tag would render as literal text")
	}
}

func TestRenderUnknownTemplate(t *testing.T) {
	if _, err := Render("no-such-email", nil, false); err == nil {
		t.Error("Render on an unknown template returned no error")
	}
}

// Everything ships into an environment with no SendGrid key, so "does nothing,
// quietly, and says it did nothing" is the behaviour that actually runs.
func TestSendWithoutAPIKeyIsACleanSkip(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "")
	t.Setenv("SENDGRID_ASM_GROUP_ID", "42")

	sent, err := SendTransactional(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
	if err != nil {
		t.Fatalf("expected a clean skip, got error: %v", err)
	}
	if sent {
		t.Error("reported a send with no API key configured")
	}

	sent, err = SendLifecycle(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
	if err != nil {
		t.Fatalf("expected a clean skip, got error: %v", err)
	}
	if sent {
		t.Error("reported a lifecycle send with no API key configured")
	}
}

// The fail-safe that keeps ADR-0010 true by construction: with no unsubscribe
// group there is no unsubscribe link, so the message is one the lawful basis
// does not cover and must not go out. Skipping writes no send-log row, so it
// arrives on a later tick once the group exists.
func TestLifecycleWithoutASMGroupDoesNotSend(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")
	t.Setenv("SENDGRID_ASM_GROUP_ID", "")

	sent, err := SendLifecycle(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
	if err != nil {
		t.Fatalf("expected a clean skip, got error: %v", err)
	}
	if sent {
		t.Error("lifecycle email reported as sent with no ASM unsubscribe group configured")
	}
}

func TestSendWithoutAddressIsACleanSkip(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")

	sent, err := SendTransactional(context.Background(),
		Recipient{Name: "No Address"}, "Subject", "invite", InviteData{})
	if err != nil {
		t.Fatalf("a missing address should be a skip, not an error: %v", err)
	}
	if sent {
		t.Error("reported a send to an empty address")
	}
}

// What would actually go over the wire, asserted without one. The ASM group is
// the part worth pinning: it does not appear in the rendered HTML at all, so no
// golden file can catch it going missing.
func TestBuildMessage(t *testing.T) {
	t.Run("lifecycle attaches the unsubscribe group", func(t *testing.T) {
		m := buildMessage(Recipient{Name: "Reader", Address: "reader@example.com"}, "Welcome", "<p>hi</p>", 42)

		body, err := json.Marshal(m)
		if err != nil {
			t.Fatalf("marshalling message: %v", err)
		}
		var payload struct {
			From struct {
				Name  string `json:"name"`
				Email string `json:"email"`
			} `json:"from"`
			Subject      string `json:"subject"`
			Personalizat []struct {
				To []struct {
					Email string `json:"email"`
				} `json:"to"`
			} `json:"personalizations"`
			ASM *struct {
				GroupID int `json:"group_id"`
			} `json:"asm"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshalling message: %v", err)
		}

		if payload.From.Email != fromAddress {
			t.Errorf("From address = %q, want %q", payload.From.Email, fromAddress)
		}
		if payload.From.Name != fromName {
			t.Errorf("From name = %q, want %q", payload.From.Name, fromName)
		}
		if payload.Subject != "Welcome" {
			t.Errorf("Subject = %q, want %q", payload.Subject, "Welcome")
		}
		if len(payload.Personalizat) != 1 || len(payload.Personalizat[0].To) != 1 ||
			payload.Personalizat[0].To[0].Email != "reader@example.com" {
			t.Errorf("recipient not set as expected: %s", body)
		}
		if payload.ASM == nil || payload.ASM.GroupID != 42 {
			t.Errorf("ASM group not set on a lifecycle message: %s", body)
		}
	})

	t.Run("transactional attaches no group", func(t *testing.T) {
		m := buildMessage(Recipient{Name: "Reader", Address: "reader@example.com"}, "You're invited", "<p>hi</p>", 0)

		body, err := json.Marshal(m)
		if err != nil {
			t.Fatalf("marshalling message: %v", err)
		}
		if strings.Contains(string(body), "\"asm\"") {
			t.Errorf("transactional message carries an ASM group: %s", body)
		}
	})
}

func TestSiteURL(t *testing.T) {
	t.Run("defaults to production", func(t *testing.T) {
		t.Setenv("SITE_URL", "")
		if got := SiteURL(); got != defaultSiteURL {
			t.Errorf("SiteURL() = %q, want %q", got, defaultSiteURL)
		}
	})

	// A trailing slash is the natural thing to put in an env var and would
	// otherwise produce "http://localhost:3000//recipes" in every link.
	t.Run("trims a trailing slash", func(t *testing.T) {
		t.Setenv("SITE_URL", "http://localhost:3000/")
		if got := SiteURL(); got != "http://localhost:3000" {
			t.Errorf("SiteURL() = %q, want %q", got, "http://localhost:3000")
		}
	})
}

// A group id that is present but unusable must behave exactly like an absent
// one. Forwarding it would put SendGrid's own 400 in the path of the fail-safe
// that exists to keep unsendable lifecycle mail from being attempted at all.
func TestLifecycleWithUnusableASMGroupDoesNotSend(t *testing.T) {
	for _, raw := range []string{"0", "-3", "not-a-number"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")
			t.Setenv("SENDGRID_ASM_GROUP_ID", raw)

			sent, err := SendLifecycle(context.Background(),
				Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
			if err != nil {
				t.Fatalf("expected a clean skip, got error: %v", err)
			}
			if sent {
				t.Errorf("lifecycle email reported as sent with SENDGRID_ASM_GROUP_ID=%q", raw)
			}
		})
	}
}

// withStubSendGrid points the package at a local server for the duration of a
// test, and is the reason sendGridBaseURL is a variable.
func withStubSendGrid(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	previous := sendGridBaseURL
	sendGridBaseURL = server.URL
	t.Cleanup(func() {
		sendGridBaseURL = previous
		server.Close()
	})
}

func TestSendReportsSuccess(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")
	withStubSendGrid(t, func(w http.ResponseWriter, r *http.Request) {
		// What SendGrid really answers a successful v3 mail send with.
		w.WriteHeader(http.StatusAccepted)
	})

	sent, err := SendTransactional(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !sent {
		t.Error("a 202 from SendGrid was not reported as a send")
	}
}

// SendGrid signals refusal by status code, not by returning an error, so a
// rejected message arrives as a perfectly successful HTTP call. Unchecked, every
// suppressed address, unverified sender or bad group id would be written to the
// send log as delivered and never retried - the send log would record sends
// that never happened.
func TestSendTreatsNon2xxAsAFailure(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.not-a-real-key")
	withStubSendGrid(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"errors":[{"message":"does not contain a valid address"}]}`))
	})

	sent, err := SendTransactional(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "invite", InviteData{})
	if err == nil {
		t.Fatal("a 400 from SendGrid was not reported as an error")
	}
	if sent {
		t.Error("a 400 from SendGrid was reported as a send")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error does not name the status code: %v", err)
	}
}

// The promise the whole programme ships on: with nothing configured, a broken
// template still cannot fail the caller's request. app.inviteUser turns an error
// from here into a 400, so an error on this path would be a user-visible
// failure on a machine that was never going to send anything.
func TestUnconfiguredSkipHappensBeforeRendering(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "")

	sent, err := SendTransactional(context.Background(),
		Recipient{Name: "A", Address: "a@example.com"}, "Subject", "no-such-template", nil)
	if err != nil {
		t.Fatalf("an unconfigured send must never error, even on a bad template: %v", err)
	}
	if sent {
		t.Error("reported a send with no API key configured")
	}
}

// Every onboarding template must carry campaign-level attribution and nothing
// else. specs/completed/email.md is emphatic: "No user or account identifier, ever. Not in
// a utm_ value, not in a separate parameter." Putting one in an email link would
// rebuild, in a URL and in every mail provider's logs, exactly the identifier
// linkage specs/account-deletion.md spends its GA4 section dismantling.
func TestLifecycleLinksCarryCampaignAndNoIdentifier(t *testing.T) {
	t.Setenv("SITE_URL", fixedSiteURL)

	for _, name := range []string{"welcome", "tips", "recipes"} {
		t.Run(name, func(t *testing.T) {
			html, err := Render(name, lifecycleData{Name: "Ada", Campaign: name}, true)
			if err != nil {
				t.Fatalf("Render: %v", err)
			}
			for _, want := range []string{
				"utm_source=email",
				"utm_medium=lifecycle",
				"utm_campaign=" + name,
			} {
				if !strings.Contains(html, want) {
					t.Errorf("no %s in the rendered email", want)
				}
			}
			// Checked against the query strings themselves rather than the
			// whole document, because the prose legitimately talks about
			// accounts and email. What matters is what travels in a URL: every
			// mail provider in the path logs those.
			for _, key := range queryKeys(t, html) {
				if !strings.HasPrefix(key, "utm_") {
					t.Errorf("link carries the query parameter %q; onboarding links may carry utm_* and nothing else", key)
				}
			}
		})
	}

	// The feedback email deliberately has no call-to-action link at all: the
	// action it asks for is a reply.
	html, err := Render("feedback", lifecycleData{Name: "Ada", Campaign: "feedback"}, true)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if strings.Contains(html, "utm_campaign") {
		t.Error("the feedback email has a campaign link; it is meant to ask for a reply instead")
	}
}

// The non-promotional condition is what ADR-0010's lawful basis is contingent
// on, and the warning lives in the templates because whoever breaks it will be
// editing copy rather than reading architecture decisions. This checks the
// warning is still there to be read.
func TestOnboardingTemplatesCarryTheNonPromotionalWarning(t *testing.T) {
	for _, name := range []string{"welcome", "tips", "recipes", "feedback"} {
		source, err := templateFS.ReadFile("templates/" + name + ".html")
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		if !strings.Contains(string(source), "NON-PROMOTIONAL") {
			t.Errorf("%s.html no longer carries the non-promotional warning", name)
		}
	}
	layout, err := templateFS.ReadFile("templates/layout.html")
	if err != nil {
		t.Fatalf("reading layout: %v", err)
	}
	if !strings.Contains(string(layout), "READ THIS BEFORE EDITING ANY EMAIL COPY") {
		t.Error("layout.html no longer carries the copy-editing warning")
	}
}

// The pixel is what specs/completed/email.md calls "the load-bearing refusal", and click
// tracking is enabled by default in SendGrid's dashboard - so the refusal only
// holds if every message says so itself. Asserted on the payload because none of
// it is visible in the rendered HTML.
func TestEveryMessageDisablesTracking(t *testing.T) {
	for _, group := range []int{0, 42} {
		m := buildMessage(Recipient{Address: "a@example.com"}, "Subject", "<p>hi</p>", group)

		body, err := json.Marshal(m)
		if err != nil {
			t.Fatalf("marshalling message: %v", err)
		}
		var payload struct {
			TrackingSettings *struct {
				ClickTracking *struct {
					Enable     *bool `json:"enable"`
					EnableText *bool `json:"enable_text"`
				} `json:"click_tracking"`
				OpenTracking *struct {
					Enable *bool `json:"enable"`
				} `json:"open_tracking"`
			} `json:"tracking_settings"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshalling message: %v", err)
		}

		ts := payload.TrackingSettings
		if ts == nil || ts.ClickTracking == nil || ts.OpenTracking == nil {
			t.Fatalf("asm group %d: tracking settings absent, so SendGrid's account defaults apply: %s", group, body)
		}
		if ts.ClickTracking.Enable == nil || *ts.ClickTracking.Enable {
			t.Errorf("asm group %d: click tracking is not explicitly disabled", group)
		}
		if ts.ClickTracking.EnableText == nil || *ts.ClickTracking.EnableText {
			t.Errorf("asm group %d: plain-text click tracking is not explicitly disabled", group)
		}
		if ts.OpenTracking.Enable == nil || *ts.OpenTracking.Enable {
			t.Errorf("asm group %d: open tracking is not explicitly disabled", group)
		}
	}
}
