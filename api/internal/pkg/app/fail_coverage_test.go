package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// bare500 matches a handler answering with a 500 without handing the cause to
// fail() - i.e. `huma.Error500InternalServerError(...)` that is not the first
// argument of a `fail(ctx, ..., err)` call.
var bare500 = regexp.MustCompile(`(?:return [^\n]*?|=\s*)huma\.Error5\d\d[A-Za-z]*\(`)

// TestNoHandlerSwallowsTheCauseOfA500 reads this package's own source and
// fails on a 500 returned without its cause.
//
// A test that greps the source rather than exercising behaviour, which needs
// justifying. The property it protects is not observable from outside: whether
// the cause reached the span changes nothing about the response, so a
// behavioural test would have to assert on telemetry that ADR-0007 requires to
// be non-essential. And the failure it protects against is *silence* - the one
// kind of bug that leaves nothing to assert on.
//
// It is here because of what silence cost on 2026-08-27. getRecipe answered
// `500 "Failed to parse recipe from db"` for every Recipe in production for a
// day; the actual error was `Unknown column 'featured' in 'field list'`, and
// because that 500 was built directly rather than through fail(), the cause
// reached neither the logs nor the trace. The only record anywhere was a bare
//
//	[negroni] 500 | 2.102292ms | GET /api/bigshop/recipe/1
//
// so diagnosing it began with guesswork. Ten other handlers were built the same
// way. register.go's comment on fail() had argued for exactly this all along -
// nothing enforced it.
//
// The repo has precedent for a test that reads files instead of calling code:
// lib/analytics/page-titles.ts is guarded by one that walks the pages/
// directory, for the same reason - the invariant is about the shape of the
// source, so that is what has to be checked.
func TestNoHandlerSwallowsTheCauseOfA500(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("listing package sources: %v", err)
	}

	for _, name := range files {
		// register.go defines fail() and discusses it at length in prose.
		if name == "register.go" || strings.HasSuffix(name, "_test.go") {
			continue
		}
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		for i, line := range strings.Split(string(body), "\n") {
			if !bare500.MatchString(line) {
				continue
			}
			if strings.Contains(line, "fail(") {
				continue
			}
			t.Errorf("%s:%d returns a 5xx without passing the cause to fail():\n    %s\n"+
				"Use fail(ctx, huma.Error500InternalServerError(%q), err) so the cause reaches the span.\n"+
				"See register.go's comment on fail, and this test's own comment for what the\n"+
				"alternative cost in production.",
				name, i+1, strings.TrimSpace(line), "...")
		}
	}
}
