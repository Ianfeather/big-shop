package purge

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// recorder is a stand-in for Netlify's purge endpoint that counts calls and
// keeps the first request's details.
type recorder struct {
	mu     sync.Mutex
	calls  int
	auth   string
	ctype  string
	method string
	body   map[string]any
	// status is what to answer with; 0 means 200.
	status int
	// gate, if non-nil, is closed by the test to release the handler - used to
	// prove Purge does not wait for the call it dispatches.
	gate chan struct{}
}

func (r *recorder) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if r.gate != nil {
			<-r.gate
		}
		raw, _ := io.ReadAll(req.Body)

		r.mu.Lock()
		r.calls++
		if r.calls == 1 {
			r.method = req.Method
			r.auth = req.Header.Get("Authorization")
			r.ctype = req.Header.Get("Content-Type")
			_ = json.Unmarshal(raw, &r.body)
		}
		status := r.status
		r.mu.Unlock()

		if status != 0 {
			w.WriteHeader(status)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

// newTestPurger builds a configured Purger pointed at rec, with a window short
// enough that a coalescing test finishes in milliseconds.
func newTestPurger(t *testing.T, rec *recorder, window time.Duration) *Purger {
	t.Helper()
	t.Setenv("NETLIFY_PURGE_TOKEN", "test-token")
	t.Setenv("NETLIFY_SITE_ID", "test-site")

	p := New()
	p.endpoint = rec.server(t).URL
	p.window = window
	return p
}

// eventually waits for cond, which is how every assertion here has to be
// written: Purge dispatches in the background by design, so there is no moment
// at which the call has definitely happened.
func eventually(t *testing.T, within time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return cond()
}

func TestPurgeSendsTheDocumentedRequest(t *testing.T) {
	rec := &recorder{}
	p := newTestPurger(t, rec, 50*time.Millisecond)

	p.Purge("units")

	if !eventually(t, time.Second, func() bool { return rec.count() == 1 }) {
		t.Fatalf("calls = %d, want 1", rec.count())
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.method != http.MethodPost {
		t.Errorf("method = %q, want POST", rec.method)
	}
	if rec.auth != "Bearer test-token" {
		t.Errorf("Authorization = %q", rec.auth)
	}
	if rec.ctype != "application/json" {
		t.Errorf("Content-Type = %q", rec.ctype)
	}
	if rec.body["site_id"] != "test-site" {
		t.Errorf("site_id = %v, want test-site", rec.body["site_id"])
	}
	// cache_tags is an array even for one tag - that is the shape the API
	// documents, and a bare string is silently accepted-and-ignored territory.
	tags, ok := rec.body["cache_tags"].([]any)
	if !ok || len(tags) != 1 || tags[0] != "units" {
		t.Errorf("cache_tags = %v, want [units]", rec.body["cache_tags"])
	}
}

// The property the whole package exists for: a Recipe save must not wait on, or
// be failed by, a purge.
func TestPurgeNeverBlocksTheCaller(t *testing.T) {
	rec := &recorder{gate: make(chan struct{})}
	p := newTestPurger(t, rec, 50*time.Millisecond)

	// The endpoint is wedged until this test says otherwise, so if Purge waited
	// for the response at all, it would wait forever.
	done := make(chan struct{})
	go func() {
		p.Purge("units")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Purge blocked on the HTTP call; a Recipe save must never wait on a purge")
	}
	close(rec.gate)
}

// A burst must cost one leading call plus one trailing call, not one per save.
// Ten saves inside a window is an ordinary afternoon with the backfill script,
// and eleven purges would earn a 429 - which is a purge that silently did not
// happen.
func TestPurgeCoalescesABurst(t *testing.T) {
	rec := &recorder{}
	// A full second, not the 150ms this started at: the mid-window assertion
	// below runs right after the ten Purge calls, so any stall longer than the
	// window - a loaded CI runner is enough - would let the trailing call land
	// first and fail the test for a reason that is not the code's fault.
	const window = time.Second
	p := newTestPurger(t, rec, window)

	for i := 0; i < 10; i++ {
		p.Purge("units")
	}

	// The first goes immediately.
	if !eventually(t, time.Second, func() bool { return rec.count() >= 1 }) {
		t.Fatalf("calls = %d, want at least the leading one", rec.count())
	}
	if got := rec.count(); got != 1 {
		t.Fatalf("calls = %d during the window, want exactly 1", got)
	}

	// The other nine collapse into a single trailing call at the window's end.
	if !eventually(t, 5*time.Second, func() bool { return rec.count() == 2 }) {
		t.Fatalf("calls = %d after the window, want 2", rec.count())
	}

	// And nothing further arrives afterwards.
	time.Sleep(window / 2)
	if got := rec.count(); got != 2 {
		t.Errorf("calls = %d, want the burst to have settled at 2", got)
	}
}

// Once the window has passed, purging is not throttled at all - a save an hour
// later must invalidate immediately, not wait.
func TestPurgeAfterTheWindowGoesImmediately(t *testing.T) {
	rec := &recorder{}
	const window = 20 * time.Millisecond
	p := newTestPurger(t, rec, window)

	p.Purge("units")
	if !eventually(t, time.Second, func() bool { return rec.count() == 1 }) {
		t.Fatalf("calls = %d, want 1", rec.count())
	}

	time.Sleep(2 * window)
	p.Purge("units")
	if !eventually(t, time.Second, func() bool { return rec.count() == 2 }) {
		t.Errorf("calls = %d, want the second purge to have gone straight out", rec.count())
	}
}

// Two tags must not throttle each other. There is one tag today; this pins the
// behaviour before a second one arrives and quietly starves the first.
func TestPurgeThrottlesPerTag(t *testing.T) {
	rec := &recorder{}
	// A long window against a short deadline, deliberately: if the two tags
	// shared one throttle, the second call would be a trailing purge five
	// seconds out and could not possibly arrive inside the 200ms below. A
	// window near the deadline would let a broken implementation squeak in.
	p := newTestPurger(t, rec, 5*time.Second)

	p.Purge("units")
	p.Purge("something-else")

	if !eventually(t, 200*time.Millisecond, func() bool { return rec.count() == 2 }) {
		t.Errorf("calls = %d, want both tags purged immediately", rec.count())
	}
}

// Local development, e2e and CI all run here. An unconfigured purger is the
// normal state, not an error, and must not attempt a call.
func TestUnconfiguredPurgerIsANoOp(t *testing.T) {
	for name, env := range map[string]struct{ token, site string }{
		"neither set":  {"", ""},
		"no token":     {"", "test-site"},
		"no site":      {"test-token", ""},
		"both present": {"test-token", "test-site"},
	} {
		t.Run(name, func(t *testing.T) {
			rec := &recorder{}
			t.Setenv("NETLIFY_PURGE_TOKEN", env.token)
			t.Setenv("NETLIFY_SITE_ID", env.site)

			p := New()
			p.endpoint = rec.server(t).URL
			p.window = 20 * time.Millisecond

			wantCalls := 0
			if env.token != "" && env.site != "" {
				wantCalls = 1
			}
			if got := p.Configured(); got != (wantCalls == 1) {
				t.Errorf("Configured() = %v", got)
			}

			p.Purge("units")

			eventually(t, 100*time.Millisecond, func() bool { return rec.count() == wantCalls })
			if got := rec.count(); got != wantCalls {
				t.Errorf("calls = %d, want %d", got, wantCalls)
			}
		})
	}
}

// A failing endpoint must be survivable - it is logged and nothing else. The
// s-maxage backstop on the cached route is what covers the miss.
func TestPurgeSurvivesAnErrorResponse(t *testing.T) {
	rec := &recorder{status: http.StatusTooManyRequests}
	p := newTestPurger(t, rec, 20*time.Millisecond)

	p.Purge("units") // must not panic

	if !eventually(t, time.Second, func() bool { return rec.count() == 1 }) {
		t.Fatalf("calls = %d, want 1", rec.count())
	}

	// And the throttle state is still sane afterwards: a later purge still goes.
	time.Sleep(40 * time.Millisecond)
	p.Purge("units")
	if !eventually(t, time.Second, func() bool { return rec.count() == 2 }) {
		t.Errorf("calls = %d, want a 429 not to have wedged the purger", rec.count())
	}
}
