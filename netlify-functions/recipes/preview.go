package main

import (
	"context"
	"flag"
	"fmt"
	"html"
	"log"
	"net/http"
	netmail "net/mail"
	"os"
	"sort"
	"strings"
	"time"

	"recipes/internal/pkg/lifecycle"
	"recipes/internal/pkg/service/email"
)

// This file is the answer to a practical problem specs/completed/email.md raises: the
// sequence is four emails over a fortnight, so taken literally, seeing the day
// 14 email means waiting fourteen days and seeing a fix to it means waiting
// another fourteen. Without a deliberate alternative, the loop people actually
// use is "deploy it and watch the first real signup" - which tests the copy on a
// stranger.
//
// Two modes, answering different questions. See "Trying it out before trusting
// it" in the spec.

// previewData is the sample data every template renders against in preview and
// send-test. Deliberately not empty: a template bug that only shows up with a
// real name in it is exactly what a preview is supposed to catch.
func previewData(campaign string) lifecycle.TemplateData {
	return lifecycle.TemplateData{Name: "Ada", Campaign: campaign}
}

// inviteSample is the invite template's sample data. Its shape has to match
// app.inviteEmailData, which is unexported, so it is restated here once rather
// than in both of the callers below.
type inviteSample struct {
	InviterName string
	Token       string
}

// runPreview serves every template in a browser, rendered, on localhost.
//
// The fast loop: no API key, no SendGrid, nothing sent. This is the cost
// specs/completed/email.md knowingly accepts for keeping the copy in version control where
// it can be code-reviewed rather than in SendGrid's template UI where it cannot.
//
// A browser reload does *not* pick up a template edit. The templates are
// go:embed-ed and parsed once in the email package's init(), so seeing a change
// means restarting this command - which `air` does automatically under
// `npm run dev:full`, and which is a keystroke otherwise. Said explicitly
// because "edit, reload, see nothing change" reads as a broken template.
//
// What it cannot tell you is whether Gmail renders it the same way, whether it
// lands in the inbox or in Promotions, or whether the unsubscribe link works -
// the substitution tag is still literal text until SendGrid rewrites it. That is
// what send-test is for.
func runPreview() {
	fs := flag.NewFlagSet("preview", flag.ExitOnError)
	port := fs.String("port", "8090", "port to serve the preview on")
	_ = fs.Parse(os.Args[2:])

	// Local by default, so a preview never renders links pointing at production
	// that you then click.
	if os.Getenv("SITE_URL") == "" {
		_ = os.Setenv("SITE_URL", "http://localhost:3000")
	}

	// A mux of its own rather than http.DefaultServeMux: the default is process
	// global, so registering on it from here would put these handlers in reach
	// of anything else in this binary that ever served on it.
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.Trim(r.URL.Path, "/")
		if name == "" {
			writePreviewIndex(w)
			return
		}

		// Onboarding email or transactional? It decides whether the unsubscribe
		// footer renders, so the preview has to show each family as it really
		// sends rather than picking one and being wrong about the other.
		var (
			data           any
			unsubscribable bool
		)
		if entry, err := lifecycle.EmailFor(lifecycle.Kind(name)); err == nil {
			data, unsubscribable = previewData(string(entry.Kind)), true
		} else {
			data, unsubscribable = inviteSample{"Ada Lovelace", "preview-token"}, false
		}

		rendered, err := email.Render(name, data, unsubscribable)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(rendered))
	})

	// Bound to the loopback interface, not to every interface. This renders
	// application copy on a developer's machine and has no business being
	// reachable from the network it happens to be on - and the log line below
	// said "localhost" while `:port` would have listened everywhere, which is
	// the kind of mismatch nobody checks.
	addr := "127.0.0.1:" + *port
	log.Printf("email preview on http://%s (links point at %s)", addr, email.SiteURL())
	log.Fatal(http.ListenAndServe(addr, mux))
}

func writePreviewIndex(w http.ResponseWriter) {
	names := []string{"invite"}
	for _, entry := range lifecycle.Sequence {
		names = append(names, entry.Template)
	}
	sort.Strings(names)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<!doctype html><meta charset="utf-8"><title>Big Shop email preview</title>`+
		`<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;line-height:1.6">`+
		`<h1>Big Shop email preview</h1><ul>`)
	for _, name := range names {
		fmt.Fprintf(w, `<li><a href="/%s">%s</a></li>`, html.EscapeString(name), html.EscapeString(name))
	}
	fmt.Fprint(w, `</ul><p style="color:#666">Nothing here sends. Use <code>send-test</code> for that.</p></body>`)
}

// runSendTest sends one named email, now, to one address, through SendGrid.
//
// The only way to answer the questions no local tool can: inbox placement, how
// the layout degrades in Gmail, Outlook and Apple Mail, whether SPF and DKIM
// align, and whether the unsubscribe link actually resolves.
//
// A subcommand rather than an HTTP route, and that is a security decision. A
// route that sends mail to an address in its request body is an open relay
// wearing a Big Shop badge, and the moment it exists somebody has to keep it
// authenticated forever. The binary already dispatches on os.Args[1], so this is
// the established shape, and `fly ssh console` reaches it in production without
// any of it being exposed to the internet.
//
// **It never writes an email_send row**, which is why it needs no database at
// all. A test send is not a send to that user: the send log is the idempotency
// guarantee for the real sequence, so polluting it would mean a real user
// silently never receiving the email you were testing.
//
// A trap worth knowing before the first run: SendGrid suppression is permanent
// and keyed on the address, not the user. Click your own unsubscribe link while
// testing and every later send to that address is accepted, logged as a success,
// and delivered nowhere - indistinguishable from a broken template. Test
// unsubscribe last, or with a +suffix address you are willing to burn.
func runSendTest() {
	fs := flag.NewFlagSet("send-test", flag.ExitOnError)
	to := fs.String("to", "", "address to send to (required)")
	kind := fs.String("kind", "", "which email: welcome, tips, recipes, feedback, or invite (required)")
	name := fs.String("name", "Ada", "the recipient name to render into the template")
	if err := fs.Parse(os.Args[2:]); err != nil {
		os.Exit(2)
	}

	if *to == "" || *kind == "" {
		fmt.Fprintln(os.Stderr, "usage: recipes send-test --to=<address> --kind=<welcome|tips|recipes|feedback|invite>")
		os.Exit(2)
	}

	// Checked here rather than left to SendGrid, because an address with a typo
	// is otherwise reported as a 400 from an API several layers away, and the
	// obvious reading of that is "the template is broken".
	if _, err := netmail.ParseAddress(*to); err != nil {
		fmt.Fprintf(os.Stderr, "--to is not a valid email address: %v\n", err)
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	recipient := email.Recipient{Name: *name, Address: *to}

	// The invite is transactional and carries no unsubscribe group, so it goes
	// down the other path deliberately - sending it as an onboarding email would
	// preview something that is not what really gets sent.
	if *kind == "invite" {
		data := inviteSample{*name, "send-test-token"}
		sent, err := email.SendTransactional(ctx, recipient,
			"You have been invited to join a Big Shop Account", "invite", data)
		reportSendTest(sent, err, *kind, *to)
		return
	}

	entry, err := lifecycle.EmailFor(lifecycle.Kind(*kind))
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(2)
	}

	sent, err := email.SendLifecycle(ctx, recipient, entry.Subject, entry.Template,
		previewData(string(entry.Kind)))
	reportSendTest(sent, err, *kind, *to)
}

func reportSendTest(sent bool, err error, kind, to string) {
	switch {
	case err != nil:
		fmt.Fprintf(os.Stderr, "failed to send %s to %s: %v\n", kind, to, err)
		os.Exit(1)
	case !sent:
		// The clean-skip path, which is what an unconfigured environment gets.
		// Said explicitly because "it printed nothing and exited 0" is
		// indistinguishable from success otherwise.
		fmt.Printf("nothing sent: SENDGRID_API_KEY, or SENDGRID_ASM_GROUP_ID for onboarding email, is not set\n")
	default:
		fmt.Printf("sent %s to %s\n", kind, to)
	}
}
