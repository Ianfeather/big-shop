package telemetry

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// healthRoute is the one path deliberately left untraced.
//
// Phase 1's allow-list of a single route is gone: every route is instrumented
// now, which is what Phase 3 asks for. What replaces it is a single exclusion,
// because /health is polled rather than requested. Fly checks it every 30s on
// every machine, and Session 7 adds a Grafana synthetic check at roughly 1/min
// on top - several thousand spans a day, all identical, none of which anyone
// will ever read. Left in, they would also dominate the duration histogram and
// make the p99 of "a Big Shop request" mean nothing.
//
// Compared against route() rather than the raw path, so it is the same route
// template that appears on spans and metric labels rather than a second,
// subtly different spelling of it.
const healthRoute = "/health"

// unmatchedRoute is the single bucket every unrecognised path collapses into,
// so that traffic nobody registered - 404s, vulnerability scanners, a typo -
// cannot add label values to the metrics from outside.
const unmatchedRoute = "unmatched"

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
func Handler(next http.Handler, basePath string, templates []string) http.Handler {
	return otelhttp.NewHandler(next, "",
		otelhttp.WithFilter(func(r *http.Request) bool {
			return isTracedRoute(basePath, templates, r.URL.Path)
		}),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + route(basePath, templates, r.URL.Path)
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
			return []attribute.KeyValue{attribute.String("http.route", route(basePath, templates, r.URL.Path))}
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
func Middleware(basePath string, templates []string, userSub func(*http.Request) string) func(http.ResponseWriter, *http.Request, http.HandlerFunc) {
	return func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		span := trace.SpanFromContext(r.Context())

		attrs := []attribute.KeyValue{
			attribute.String("http.route", route(basePath, templates, r.URL.Path)),
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

// SetAuthFailureReason records why the auth chain refused a request, on the
// span the request already has.
//
// This exists because a 401 is the one outcome the rest of this file cannot
// describe. Middleware runs *after* the auth pair (see app.GetRouter), and a
// refused request never reaches it - so a 401 span carries the otelhttp
// attributes and nothing else: no user.sub to say who was refused, and nothing
// at all to say why. The distinction the API does draw, "JWT is missing."
// against "JWT is invalid.", lives only in the response body, and the two
// bodies are both exactly 29 bytes, so not even http.response.body.size can
// separate them from outside.
//
// A classification, not an identifier and emphatically not the token: ADR-0008
// §1 excludes content, and the values are a closed set of constants declared in
// package app. On the span only, never on a metric - the set is small enough
// that a label would be safe, but "why was this refused" is not a property of
// the duration histogram, and ADR-0008 §2's rule is that a span is where a fact
// about one request belongs.
func SetAuthFailureReason(ctx context.Context, reason string) {
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("auth.failure_reason", reason))
}

// isTracedRoute reports whether a request should produce a server span. Every
// route does, except the health check - see healthRoute.
//
// One test covers both paths app.go answers the check on. `base + "/health"`
// has its prefix stripped by route(); a bare "/health" does not match the
// prefix and passes through unchanged. Both arrive here as "/health".
func isTracedRoute(basePath string, templates []string, path string) bool {
	return route(basePath, templates, path) != healthRoute
}

// route reduces a request path to the low-cardinality template that belongs on
// a span name and, more importantly, on the duration histogram's labels.
//
// Matched against the templates the router actually registered, rather than
// inferred from the shape of the path. Inferring was the first implementation
// and it was wrong in a way that mattered: it replaced any *numeric* segment
// with {id}, which is fine for "/recipe/41" and useless for "/recipe/katsu-
// curry" - `GET /recipe/{id}` accepts a slug too (app/recipe.go tries
// strconv.Atoi and falls back to a slug lookup). That put a **recipe name**
// into the span name and into an `http.route` metric label: content on a span,
// which ADR-0008 §1 forbids, and an unbounded label, which §2 forbids and
// which grows the series count with the size of the recipe table.
//
// Anything not matching a registered template collapses to "unmatched" - one
// bucket for 404s, scanners and probes, which are otherwise the easiest way for
// a stranger to add label values to your metrics from the outside.
func route(basePath string, templates []string, path string) string {
	if basePath != "" && strings.HasPrefix(path, basePath) {
		path = path[len(basePath):]
	}
	if path == healthRoute {
		return healthRoute
	}
	segments := strings.Split(path, "/")
	for _, t := range templates {
		if matchTemplate(strings.Split(t, "/"), segments) {
			return t
		}
	}
	return unmatchedRoute
}

// matchTemplate reports whether a concrete path matches a route template,
// treating any {placeholder} segment as a wildcard.
func matchTemplate(tmpl, segments []string) bool {
	if len(tmpl) != len(segments) {
		return false
	}
	for i, t := range tmpl {
		if strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}") {
			if segments[i] == "" {
				return false
			}
			continue
		}
		if t != segments[i] {
			return false
		}
	}
	return true
}

// RecordHandlerError attaches a failed handler's error to the request's span.
//
// Split by status deliberately. The error is always *recorded*, so the cause is
// there to read whatever happened - but only 5xx sets the span's status to
// Error. A 404 for a Recipe that does not exist, or a 422 for a malformed body,
// is the API working correctly; marking those spans failed would make "show me
// the errors" mean "show me the traffic", which is the fastest way to make an
// error rate worthless.
//
// A no-op on an untraced request: SpanFromContext returns a non-recording span
// and discards both calls.
func RecordHandlerError(ctx context.Context, err error, status int) {
	span := trace.SpanFromContext(ctx)
	span.RecordError(err)
	if status >= http.StatusInternalServerError {
		span.SetStatus(codes.Error, err.Error())
	}
}

// RecordWarning notes a non-fatal problem on the request's span.
//
// For the failures a caller deliberately ignores - best-effort catalog
// enrichment, a shopping-list history row that did not get written - where
// there is no error to return and wrapping is therefore not available. A span
// event keeps the service layer free of logging (ADR-0008 §3) while leaving the
// fact somewhere it can be found, attached to the request that caused it.
//
// `what` names the operation and is expected to be a short fixed string, not a
// formatted detail: the lines this replaced named the ingredient ("could not
// set unit size %q for %q"), and ingredient text is what ADR-0008 §1 says
// telemetry does not carry. That is a real loss of resolution, and it is the
// trade the ADR already makes explicit - the identifiers narrow it to one
// request and one Account, and the rest is reproducible locally.
//
// It is a convention rather than a guarantee, and worth being honest about:
// err.Error() is passed through, and some driver errors embed the offending
// value (MySQL 1062 reads `Duplicate entry 'chicken thighs' for key ...`). The
// same is true of any error reaching a span through fail(). Sanitising driver
// text was considered and rejected as the kind of filter that is wrong in both
// directions; the containment is that these are Grafana Cloud, not a public
// surface.
func RecordWarning(ctx context.Context, what string, err error) {
	trace.SpanFromContext(ctx).AddEvent("warning", trace.WithAttributes(
		attribute.String("warning.operation", what),
		attribute.String("warning.error", err.Error()),
	))
}
