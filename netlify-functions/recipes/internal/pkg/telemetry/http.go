package telemetry

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// phase1Routes is the allow-list of operations that produce a server span.
//
// specs/observability.md's Phase 1 is deliberately *one* route end to end
// rather than everything at once, so that the first thing proved is that the
// pipeline works - trace, its logs and its metric, correlated - on a surface
// small enough to reason about. Phase 3 (Session 3) widens this to every route,
// at which point this filter and Middleware's use of it both go away.
//
// Keyed by method and route together, and compared against route() rather than
// the raw path, so the entries here are the same route templates that appear on
// spans and metric labels rather than a second, subtly different spelling of
// them. (A suffix match on the raw path would also work today - no other route
// ends in "/recipes" - but only by luck: "/recipe" and "/recipes" are one
// character apart and both exist.)
//
// Including the method is what makes this honestly "one route": keyed by path
// alone, a POST or PUT to the same path would be traced too, which is one more
// route than Phase 1 says it is instrumenting.
var phase1Routes = map[string]bool{"GET /recipes": true}

// Handler wraps the whole HTTP stack in OpenTelemetry instrumentation: one
// server span per request, plus the http.server.request.duration histogram that
// the spec's Phase 1 asks for as its single metric. Both come from otelhttp
// rather than hand-rolled, so the attributes are the semconv-standard ones a
// stock Grafana dashboard already knows how to read.
//
// Applied outside the negroni stack (see main.go) so the span covers middleware
// as well as the handler - if auth or CORS is what is slow, the span should say
// so. The consequence is that the span starts before the user is known, which
// is why the identifying attributes are added later, by Middleware.
func Handler(next http.Handler, basePath string) http.Handler {
	return otelhttp.NewHandler(next, "",
		otelhttp.WithFilter(func(r *http.Request) bool {
			return isTracedRoute(basePath, r.Method, r.URL.Path)
		}),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + route(basePath, r.URL.Path)
		}),
		// otelhttp does not put http.route on its metrics unless told: it only
		// knows the concrete URL, and guessing a template from it is the
		// router's job, not the instrumentation's. Without this the duration
		// histogram is split by method and status alone, which is not the
		// "duration histogram by route and status" ADR-0008 costs out at ~970
		// series - it is a far blunter instrument that cannot answer "which
		// endpoint got slow".
		//
		// Safe to add precisely because route() collapses ids to {id}: the label
		// is bounded by the number of registered routes, not by the size of the
		// recipe table.
		otelhttp.WithMetricAttributesFn(func(r *http.Request) []attribute.KeyValue {
			return []attribute.KeyValue{attribute.String("http.route", route(basePath, r.URL.Path))}
		}),
	)
}

// Middleware returns a negroni-shaped middleware that records the attributes
// making a span findable months later, once the middleware below it has
// established who is asking.
//
// ADR-0008 §1 is the rule for what goes on here: pseudonymous identifiers, never
// content. user.sub and account.id are exactly the handles that answer "show me
// everything that happened for this account around 14:20"; a recipe name or an
// email address would not be.
//
// userSub is injected rather than read from the context here, because the
// context key it lives under is an unexported named type in package app, and Go
// compares context keys by *type* as well as value - a same-shaped string type
// declared in this package is a different key and silently finds nothing. (It
// did: the first version of this file looked the value up that way, and every
// span shipped without a user.sub until a trace was actually read back.)
// Passing app's own accessor in keeps the key private to the package that owns
// it, with no import cycle and no wider refactor of the handlers.
//
// The returned middleware is a no-op when the request was filtered out of
// tracing - SpanFromContext gives back a non-recording span and every
// SetAttributes call on it is discarded, so it needs no guard of its own.
func Middleware(basePath string, userSub func(*http.Request) string) func(http.ResponseWriter, *http.Request, http.HandlerFunc) {
	return func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		span := trace.SpanFromContext(r.Context())

		attrs := []attribute.KeyValue{
			attribute.String("http.route", route(basePath, r.URL.Path)),
		}

		if sub := userSub(r); sub != "" {
			attrs = append(attrs, attribute.String("user.sub", sub))
		}

		// The only handle that ties a Big Shop trace to Netlify's own request
		// logs, for anything arriving through the edge rewrite. One attribute,
		// and the alternative is having no way to cross that boundary at all.
		if id := r.Header.Get("x-nf-request-id"); id != "" {
			attrs = append(attrs, attribute.String("netlify.request_id", id))
		}

		span.SetAttributes(attrs...)
		next(w, r)
	}
}

// SetAccountID records the Account a request resolved to, called from wherever
// that first becomes known.
//
// It is a helper rather than something a caller does inline because the caller
// is in the service layer, and the point is that the service layer says one
// short true thing and knows nothing about spans. Note this is *not* the
// logging that ADR-0008 §3 forbids there: it adds a fact to a span the request
// already has, rather than emitting a second, redundant record of it.
//
// account.id belongs on spans and never on metrics - ADR-0008 §2. It is free
// here and multiplies every series by the account count there.
func SetAccountID(ctx context.Context, accountID int) {
	trace.SpanFromContext(ctx).SetAttributes(attribute.Int("account.id", accountID))
}

// isTracedRoute reports whether a method and path are in the Phase 1 allow-list.
func isTracedRoute(basePath, method, path string) bool {
	return phase1Routes[method+" "+route(basePath, path)]
}

// route reduces a request path to the low-cardinality template that belongs on
// a span and, more importantly, on the duration histogram's labels.
//
// Without this, "/recipe/41" and "/recipe/42" are different label values and the
// series count grows with the Recipe table - the unbounded-label failure
// ADR-0008 §2 is about.
//
// basePath is passed in rather than hardcoded because main.go already owns that
// value and it is genuinely two different strings at runtime - "/api/bigshop"
// for the server, "/.netlify/functions/recipes" for the Lambda. A copy of the
// literal here would go stale silently: routes would keep their prefix, every
// label would change, and nothing would fail.
func route(basePath, path string) string {
	if basePath != "" && strings.HasPrefix(path, basePath) {
		path = path[len(basePath):]
	}
	if path == "" {
		return "/"
	}
	segments := strings.Split(path, "/")
	for i, s := range segments {
		if isNumeric(s) {
			segments[i] = "{id}"
		}
	}
	return strings.Join(segments, "/")
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
