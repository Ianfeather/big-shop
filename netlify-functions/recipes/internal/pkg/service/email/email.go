// Package email is the one place Big Shop hands a message to SendGrid.
//
// Before this package there was exactly one send in the whole codebase, inline
// in app.inviteUser: a hardcoded personal From address, a link to an API
// Gateway stack from an architecture this app no longer has, and a 400 returned
// to the caller when the send failed. specs/email.md exists partly to stop that
// shape being copied three more times, so everything that sends now comes
// through here.
//
// Four properties shape the code below. Each is a requirement rather than a
// nicety, and three of them are things the package must do when it is *not*
// configured - which, today, is everywhere.
//
//   - **No SENDGRID_API_KEY is a clean skip, never an error.** There is no key
//     in any environment right now, so this is the state the whole email
//     programme ships into. The ticker runs, finds who is due, finds no key,
//     and writes no send-log rows - so nothing is marked sent and the sequence
//     begins correctly the moment a key lands.
//
//   - **The key is read per call, not at startup.** specs/email.md verified by
//     booting the production image without it that the API starts clean and
//     /health answers 200, and required everything here to preserve that. A
//     package-level client built in init() would quietly turn a missing
//     credential into a failed deploy.
//
//   - **A lifecycle email cannot be sent without an unsubscribe.** ADR-0010
//     rests the entire lawful basis on a working unsubscribe in every send, so
//     an unset SENDGRID_ASM_GROUP_ID skips the send rather than delivering a
//     message that cannot be unsubscribed from. See SendLifecycle.
//
//   - **Templates are parsed at startup.** A malformed template is a panic in
//     the first test that runs, not a send that fails at 10:00 on someone's
//     day 3.
package email

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/sendgrid/sendgrid-go"
	"github.com/sendgrid/sendgrid-go/helpers/mail"
)

// The sender identity, settled once here rather than per email type.
//
// specs/email.md is explicit that this is one task and not several: the invite
// email had picked "Ian Feather" <info@ianfeather.co.uk> years ago, and every
// new email type would otherwise re-litigate it. One verified sender on one
// domain is also what makes SPF and DKIM alignment a single piece of DNS work
// rather than one per address.
const (
	fromName    = "Big Shop"
	fromAddress = "hello@bigshop.life"
)

// defaultSiteURL is where links in emails point when SITE_URL is unset.
//
// Not read from NEXT_PUBLIC_HOST: that is a frontend build-time variable which
// this process has never had and should not start depending on. The default is
// production because production is the only place email actually sends; SITE_URL
// exists so the local preview route renders links you can click.
const defaultSiteURL = "https://www.bigshop.life"

// unsubscribeTag is SendGrid's substitution token for the raw unsubscribe URL
// of the ASM group set on the message. SendGrid replaces it at send time and
// hosts the confirmation page, adds the List-Unsubscribe and
// List-Unsubscribe-Post headers Gmail and Yahoo look for, and suppresses future
// sends to that address itself.
//
// Keeping the suppression on SendGrid's side rather than in a column here is
// what makes an unsubscribe outlive the Account: specs/account-deletion.md
// deletes our own rows, and a decision stored among them would be undone by a
// re-signup with the same address.
//
// **It is written literally into templates/layout.html, not injected as data,
// and that is not a style choice.** html/template treats an href as a URL
// context and normalizes anything substituted into one, percent-encoding the
// angle brackets into `%3c%asm_group_unsubscribe_raw_url%3e` - which SendGrid
// does not recognise, so it survives into the delivered mail as a dead
// unsubscribe link. A template.URL does not help: that skips the safety
// *filter*, not the normalizer. Literal template text is not escaped at all.
// This constant exists so a test can assert the layout still contains the tag;
// nothing else reads it.
const unsubscribeTag = "<%asm_group_unsubscribe_raw_url%>"

//go:embed templates/*.html
var templateFS embed.FS

// templates holds one parsed template set per content file, each already
// combined with the layout.
//
// One set per email rather than one set for everything, because every content
// file defines a block called "content" and they would otherwise overwrite each
// other - the last one parsed would win and every email would render the same
// body. Parsing them separately is what lets the layout stay a single file that
// no individual template can forget to use.
var templates = map[string]*template.Template{}

func init() {
	entries, err := fs.ReadDir(templateFS, "templates")
	if err != nil {
		panic("email: cannot read embedded templates: " + err.Error())
	}
	for _, entry := range entries {
		if entry.Name() == "layout.html" {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".html")
		templates[name] = template.Must(template.ParseFS(templateFS,
			"templates/layout.html", "templates/"+entry.Name()))
	}
}

// Recipient is who a message is addressed to. Name may be empty; SendGrid is
// content with an address alone, and for a lifecycle email sent to somebody
// whose name we never captured that is the honest thing to send.
type Recipient struct {
	Name    string
	Address string
}

// view is what a template actually executes against.
//
// The caller's data is nested under .Data rather than merged, so a content
// template can never shadow a layout field - and so adding a field to the
// layout can never collide with a field some template already uses. Content
// templates therefore say {{ .Data.InviterName }}, and the layout says
// {{ .Unsubscribable }}.
type view struct {
	Data any
	// SiteURL is the app's base URL, so templates build links without each
	// hardcoding a host.
	SiteURL string
	// Unsubscribable is false for transactional mail, which is deliberately not
	// unsubscribable (ADR-0010), and the layout omits the footer link entirely
	// when it is. Everything transactional is something the recipient asked for
	// by taking an action a moment earlier.
	Unsubscribable bool
}

// SiteURL is the base URL links in emails should point at.
func SiteURL() string {
	if url := os.Getenv("SITE_URL"); url != "" {
		return strings.TrimSuffix(url, "/")
	}
	return defaultSiteURL
}

// Render produces the full HTML for one email without sending anything.
//
// Exported because two callers want rendering without a send: the golden-file
// tests, and the development-only preview route - which is the cost
// specs/email.md knowingly accepts for keeping the copy in version control
// where it can be code-reviewed, instead of in SendGrid's template UI where it
// cannot.
//
// unsubscribable is passed rather than inferred so the preview shows exactly
// what each family really sends, footer included.
func Render(name string, data any, unsubscribable bool) (string, error) {
	tmpl, ok := templates[name]
	if !ok {
		return "", fmt.Errorf("email: no template named %q", name)
	}

	v := view{Data: data, SiteURL: SiteURL(), Unsubscribable: unsubscribable}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, v); err != nil {
		return "", fmt.Errorf("email: rendering %q: %w", name, err)
	}
	return buf.String(), nil
}

// asmGroupID is the SendGrid unsubscribe group every lifecycle send belongs to,
// or 0 when it is not configured.
//
// One group for the whole lifecycle family, so unsubscribing from any of the
// four stops the rest - which is what someone who unsubscribes means, and what
// specs/email.md chose over a preference centre: four emails over a fortnight
// do not justify per-category preferences.
func asmGroupID() int {
	raw := os.Getenv("SENDGRID_ASM_GROUP_ID")
	if raw == "" {
		return 0
	}
	id, err := strconv.Atoi(raw)
	if err != nil {
		log.Printf("email: SENDGRID_ASM_GROUP_ID is not a number (%q); lifecycle email will not send", raw)
		return 0
	}
	return id
}

// SendLifecycle sends one email from the onboarding sequence.
//
// It refuses to send without a configured ASM group, and that refusal is the
// mechanical form of ADR-0010's load-bearing condition. The lawful basis for
// mailing every new user without asking first is legitimate interests *given* a
// working unsubscribe in every message; without the group there is no
// unsubscribe link, no List-Unsubscribe header and no suppression, so the
// message would be one the basis does not cover. Skipping is the safe failure -
// the send log is only written on a real send, so the email arrives on the next
// tick once the group exists.
//
// Reports whether the message was actually handed to SendGrid. A false with a
// nil error is the ordinary unconfigured case and is not a fault.
func SendLifecycle(ctx context.Context, to Recipient, subject, templateName string, data any) (bool, error) {
	group := asmGroupID()
	if group == 0 {
		log.Printf("email: SENDGRID_ASM_GROUP_ID is unset; skipping lifecycle email %q", templateName)
		return false, nil
	}
	return send(ctx, to, subject, templateName, data, group)
}

// SendTransactional sends one message caused by something the recipient just
// did - an invite, and in a later phase a deletion confirmation.
//
// No ASM group, deliberately: transactional email is not unsubscribable and
// should not be (specs/email.md, "What this spec does not do"). Someone who
// unsubscribes from the onboarding sequence has said nothing about whether they
// want to be told their Account was deleted.
//
// Two exported entry points rather than one Send with a flag, so the difference
// that matters cannot be got wrong by omission: there is no way to send a
// lifecycle email down the path that skips the unsubscribe.
func SendTransactional(ctx context.Context, to Recipient, subject, templateName string, data any) (bool, error) {
	return send(ctx, to, subject, templateName, data, 0)
}

// send renders and delivers, or cleanly declines to.
//
// The API key is read here, on every call, rather than captured once. See the
// package comment: the production image must start without it.
func send(ctx context.Context, to Recipient, subject, templateName string, data any, asmGroup int) (bool, error) {
	if to.Address == "" {
		// A user row with no address is a skip, not an error.
		// specs/email.md does not assume the address column is complete or
		// accurate - nobody has ever checked it - so the whole design degrades
		// to "send them nothing" rather than to a failure that would abort a
		// tick partway through everyone else's mail.
		return false, nil
	}

	html, err := Render(templateName, data, asmGroup != 0)
	if err != nil {
		return false, err
	}

	key := os.Getenv("SENDGRID_API_KEY")
	if key == "" {
		log.Printf("email: SENDGRID_API_KEY is unset; not sending %q", templateName)
		return false, nil
	}

	message := buildMessage(to, subject, html, asmGroup)

	response, err := sendgrid.NewSendClient(key).SendWithContext(ctx, message)
	if err != nil {
		return false, fmt.Errorf("email: sending %q: %w", templateName, err)
	}
	// SendGrid signals refusal by status code, not by error, so a 4xx arrives
	// here as a perfectly successful HTTP call. Left unchecked, every rejected
	// message - a suppressed address, an unverified sender, a bad group id -
	// would be recorded in the send log as delivered and never retried.
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return false, fmt.Errorf("email: sending %q: sendgrid returned %d: %s",
			templateName, response.StatusCode, response.Body)
	}

	return true, nil
}

// buildMessage assembles the SendGrid payload.
//
// Split out from send so a test can assert on what would be transmitted -
// sender, recipient, subject, and whether an unsubscribe group is attached -
// without a network call or an API key. The ASM assertion is the one worth
// having: it is the difference between an email ADR-0010 covers and one it does
// not, and it is invisible in the rendered HTML.
func buildMessage(to Recipient, subject, html string, asmGroup int) *mail.SGMailV3 {
	from := mail.NewEmail(fromName, fromAddress)
	recipient := mail.NewEmail(to.Name, to.Address)

	// The plain-text part is deliberately empty rather than a stripped-down
	// copy of the HTML. SendGrid generates a text alternative from the HTML
	// itself, which stays correct when the copy is edited; a hand-maintained
	// second copy is one more place for the two to drift apart.
	message := mail.NewSingleEmail(from, subject, recipient, "", html)

	if asmGroup != 0 {
		message.SetASM(mail.NewASM().SetGroupID(asmGroup))
	}

	return message
}
