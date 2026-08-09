// Package purge invalidates Netlify's edge cache for a cache tag.
//
// It exists for exactly one route. /units is a `public` response cached at
// Netlify's edge for five minutes (see internal/pkg/app/units.go), but the Unit
// catalog is Open: saving a Recipe upserts every Unit its ingredients
// reference, so an import can coin "bunch" at any moment. The five minutes is
// the backstop; this is the mechanism that is supposed to do the work.
//
// Three properties shape everything below, and each is a requirement rather
// than a nicety:
//
//   - **It must never fail a Recipe save.** A purge is a cache optimisation; a
//     save is the user's data. So Purge returns immediately, the HTTP call
//     happens on a goroutine, and a failure is logged and goes no further.
//
//   - **It must survive a burst.** Netlify allows a tag to be purged twice
//     every five seconds and returns 429 beyond that. A user saving several
//     recipes, the e2e suite, or a re-run of scripts/backfill-recipe-method.mjs
//     all exceed that comfortably, so calls coalesce rather than queue.
//
//   - **It must do nothing when unconfigured.** Local development, e2e and CI
//     have no Netlify token and no edge in front of them. An unconfigured
//     purger is a no-op, not an error.
package purge

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// netlifyPurgeURL is Netlify's purge endpoint. It takes a site and a set of
// cache tags, and invalidates them across the whole network in a few seconds.
const netlifyPurgeURL = "https://api.netlify.com/api/v1/purge"

// rateLimitWindow is how long to wait between purges of the same tag.
//
// Netlify's documented limit is two per tag per five seconds; this allows one,
// which is deliberately the more conservative half of it. Purging twice in a
// window buys nothing - the second call invalidates what the first already
// did - whereas a 429 is a purge that silently did not happen.
//
// The spare half is not just caution. `last` is stamped when the send is
// *decided*, not when Netlify receives it, so a request delayed by anything up
// to the client timeout can arrive later than its slot implies and land closer
// to its neighbour than five seconds. Spending one of the two allowed purges
// leaves room for that without ever tipping into a 429.
const rateLimitWindow = 5 * time.Second

// requestTimeout bounds the background call. Nothing waits on it, so the only
// thing an unbounded request would achieve is holding a goroutine and a
// connection open against an unresponsive endpoint.
const requestTimeout = 10 * time.Second

// Purger invalidates cache tags at Netlify's edge.
//
// The zero value is not usable; call New. A Purger with no token or no site ID
// is valid and does nothing, which is the normal state outside production.
type Purger struct {
	token  string
	siteID string
	client *http.Client
	// endpoint and window are fields rather than the constants above so a test
	// can point at an httptest.Server and shrink the window to milliseconds -
	// coalescing is the part worth testing and a real 5s window would make the
	// suite crawl. Nothing in production sets either.
	endpoint string
	window   time.Duration

	mu sync.Mutex
	// state per tag, so two tags never throttle each other. There is one tag
	// today; a map costs nothing and removes the question.
	tags map[string]*tagState
}

type tagState struct {
	// last is when a purge for this tag was last dispatched.
	last time.Time
	// pending is set when a purge arrived inside the rate-limit window and a
	// trailing call has already been scheduled for it. It is what collapses a
	// burst into one call: the tenth save in a window sets a flag that is
	// already set, rather than scheduling a tenth purge.
	pending bool
}

// New returns a Purger configured from the environment.
//
// NETLIFY_PURGE_TOKEN is a Netlify personal access token and NETLIFY_SITE_ID
// the site's API ID. With either missing the Purger is a no-op - see
// Configured, and the package comment for why that is the sane default rather
// than a misconfiguration to shout about.
func New() *Purger {
	return &Purger{
		token:    os.Getenv("NETLIFY_PURGE_TOKEN"),
		siteID:   os.Getenv("NETLIFY_SITE_ID"),
		client:   &http.Client{Timeout: requestTimeout},
		endpoint: netlifyPurgeURL,
		window:   rateLimitWindow,
		tags:     map[string]*tagState{},
	}
}

// Configured reports whether this Purger will actually call Netlify. Useful for
// a startup log line - "purging disabled" is worth knowing on a host that was
// meant to have it.
func (p *Purger) Configured() bool {
	return p.token != "" && p.siteID != ""
}

// Purge invalidates tag at Netlify's edge. It returns immediately, always.
//
// Callers are on the request path of a Recipe save and must not learn whether
// this worked: there is nothing they could usefully do about it, and the
// s-maxage backstop on the cached route is what covers a purge that did not
// happen.
func (p *Purger) Purge(tag string) {
	if !p.Configured() {
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	state, ok := p.tags[tag]
	if !ok {
		state = &tagState{}
		p.tags[tag] = state
	}

	// A trailing purge is already scheduled and will cover this call too. This
	// is the branch that makes a burst cost one request.
	//
	// "Will cover this call" is the load-bearing claim, and it is worth
	// spelling out because it looks unsafe: the callback below clears pending
	// *before* it sends, so this early return could plausibly hand off to a
	// purge that has already gone. It cannot. Seeing pending == true means this
	// goroutine took p.mu before the callback did, and the callback only sends
	// after taking p.mu - so the caller's write, this call, and that send are
	// totally ordered, in that order. If the callback wins the mutex instead,
	// pending is false by the time this reads it and the branch below schedules
	// a fresh trailing purge.
	//
	// The invariant is therefore: pending must be cleared under the same mutex
	// that orders the send. Moving the clear to after p.send - which reads like
	// a tidy-up - breaks it silently, and the symptom is a Unit that never
	// appears until the s-maxage expires.
	if state.pending {
		return
	}

	// No IsZero guard on state.last: time.Since on a zero Time saturates at
	// ~2562047h, so wait is hugely negative on the first call and this branch
	// is skipped without one.
	if wait := p.window - time.Since(state.last); wait > 0 {
		state.pending = true
		time.AfterFunc(wait, func() {
			p.mu.Lock()
			state.pending = false
			state.last = time.Now()
			p.mu.Unlock()
			p.send(tag)
		})
		return
	}

	state.last = time.Now()
	go p.send(tag)
}

// send makes the call. Every failure path ends in a log line and nothing else -
// see the package comment.
func (p *Purger) send(tag string) {
	body, err := json.Marshal(map[string]any{
		"site_id":    p.siteID,
		"cache_tags": []string{tag},
	})
	if err != nil {
		log.Printf("cache purge: could not encode request for tag %q: %v", tag, err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		log.Printf("cache purge: could not build request for tag %q: %v", tag, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("cache purge: request for tag %q failed: %v", tag, err)
		return
	}
	defer resp.Body.Close()
	// Drained, not just closed, so the connection can be reused. At one request
	// per five seconds this saves almost nothing; it costs one line and avoids
	// the reader wondering whether it was an oversight.
	defer io.Copy(io.Discard, resp.Body)

	// 429 is called out by name because it is the one failure the coalescing
	// above is meant to prevent - seeing it in the logs means a burst got
	// through, which is a bug here rather than bad luck.
	if resp.StatusCode == http.StatusTooManyRequests {
		log.Printf("cache purge: rate limited purging tag %q; the s-maxage backstop covers this, but the coalescing should have prevented it", tag)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("cache purge: purging tag %q returned %d", tag, resp.StatusCode)
	}
}
