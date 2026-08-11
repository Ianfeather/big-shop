package telemetry

import "testing"

// templates stands in for what app.RouteTemplates returns from the live router.
var templates = []string{
	"/account",
	"/recipe",
	"/recipe/{id}",
	"/recipes",
	"/shopping-list",
	"/shopping-list/buy",
	"/user/preferences",
}

// TestRouteIsBoundedAndCarriesNoContent is the guard on ADR-0008's two rules
// that this function alone enforces: no unbounded metric labels (§2), and no
// content on spans (§1).
//
// The slug case is the one that matters and the one an earlier implementation
// got wrong. `GET /recipe/{id}` accepts a slug as well as a numeric id, so a
// route derived by "replace digits with {id}" let a **recipe name** through
// into the span name and into an http.route label - content, and a label whose
// value set grows with the recipe table.
func TestRouteIsBoundedAndCarriesNoContent(t *testing.T) {
	const base = "/api/bigshop"

	tests := []struct {
		name string
		path string
		want string
	}{
		{"numeric id collapses", base + "/recipe/41", "/recipe/{id}"},
		{"slug collapses too, and does not leak the recipe name", base + "/recipe/katsu-curry", "/recipe/{id}"},
		{"a slug that looks like a sentence", base + "/recipe/mums-sunday-roast-2", "/recipe/{id}"},
		{"static route is itself", base + "/recipes", "/recipes"},
		{"nested static route", base + "/shopping-list/buy", "/shopping-list/buy"},
		{"sibling of a templated route stays distinct", base + "/recipe", "/recipe"},
		{"unregistered path is one bucket", base + "/wp-admin.php", unmatchedRoute},
		{"deep unregistered path is the same bucket", base + "/a/b/c/d", unmatchedRoute},
		{"empty id does not match the template", base + "/recipe/", unmatchedRoute},
		{"health keeps its own name", base + "/health", healthRoute},
		{"bare health, without the base prefix", "/health", healthRoute},
		{"the bare base path, which nothing registers", base, unmatchedRoute},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := route(base, templates, tt.path); got != tt.want {
				t.Errorf("route(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

// TestOnlyHealthIsUntraced pins the single carve-out from "instrument every
// route". Fly polls /health every 30s per machine and a Grafana synthetic check
// adds more, so tracing it would bury real traffic and skew the duration
// histogram; everything else, including traffic nobody registered, is traced.
func TestOnlyHealthIsUntraced(t *testing.T) {
	const base = "/api/bigshop"

	untraced := []string{base + "/health", "/health"}
	for _, p := range untraced {
		if isTracedRoute(base, templates, p) {
			t.Errorf("expected %q to be untraced", p)
		}
	}

	traced := []string{base + "/recipes", base + "/recipe/41", base + "/wp-admin.php"}
	for _, p := range traced {
		if !isTracedRoute(base, templates, p) {
			t.Errorf("expected %q to be traced", p)
		}
	}
}

// TestRouteHandlesTheLambdaBasePath guards the reason basePath is a parameter
// rather than a constant: it is genuinely two different strings at runtime, and
// a hardcoded copy would silently stop stripping.
func TestRouteHandlesTheLambdaBasePath(t *testing.T) {
	const lambdaBase = "/.netlify/functions/recipes"
	if got := route(lambdaBase, templates, lambdaBase+"/recipe/41"); got != "/recipe/{id}" {
		t.Errorf("route under the Lambda base = %q, want %q", got, "/recipe/{id}")
	}
}
