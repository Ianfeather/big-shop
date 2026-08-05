# Observability: OpenTelemetry traces, metrics and logs to Grafana Cloud

Decisions and rationale: [ADR-0007](../docs/adr/0007-observability-otel-grafana-cloud.md)
(architecture) and [ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md)
(content and cardinality rules).

**Depends on [`api-hosting-migration.md`](./api-hosting-migration.md) landing first.**
Phases 2–4 below assume the Go API is a long-lived process on Fly with a collector
sidecar available. Attempting them against the Lambda would produce a materially different
and worse design.

## Current state (why this isn't greenfield)

There is no instrumentation. What exists instead:

- **70 `log.*` calls in the Go API**, 26 of them a bare `log.Println(err)` immediately
  before returning a 500 — carrying no route, account, user or timing.
- **Double logging.** The service layer logs *and* returns; the app layer logs again. Every
  DB error appears twice (`service/invite.go:20-21` then `app/invites.go:34`).
- **A swallowed error.** `app/account.go:41` logs *any* error from `GetAccountID` as
  `"current user is not associated with an account"` and discards the real `err`, so a
  TiDB connection failure is reported to you, and to the user, as a membership problem.
- **A health check that checks nothing.** `app.go:52` writes `ok` unconditionally. It only
  detects a TiDB outage indirectly, because `main.go:68` `log.Fatalf`s on a failed ping
  during `init()` and kills the process. **A database that dies while a container is warm
  leaves `/health` returning `ok` while every real endpoint 500s.**
- 15 `console.*` calls in the frontend, and no client error reporting of any kind.

Goals, in the order they matter: know when it's broken; reconstruct what happened after
the fact. Long-horizon product questions ("is Dave used more than three months ago") are
**out of scope** and belong to Google Analytics — which is what makes Grafana Cloud Free's
14-day retention a non-issue rather than a constraint.

## Proposed approach

### Phase 1 — Vertical slice against local LGTM

Add `grafana/otel-lgtm` to `docker-compose.yml` (Collector, Tempo, Loki, Prometheus,
Grafana in one image; OTLP on 4318, Grafana on 3000 — no clash, `dev-full.sh` serves the
web app on 3001).

Then instrument exactly **one** Go route end to end with all three signals, exporting to
`localhost:4318`:

- Resource attributes: `service.namespace=bigshop`, `service.name=bigshop-api`,
  `deployment.environment.name`, `service.version` (git sha).
- One server span per request with `account.id`, `user.sub`, route, status.
- `otelsql` child spans for each query.
- `slog` via `otelslog` so log lines carry `trace_id`.
- One metric: the HTTP duration histogram.

Verify in local Grafana that a trace, its logs and its metric all correlate. Nothing
touches production.

### Phase 2 — Production, and the checkpoint

Deploy the same single route to Fly with the **OTel Collector as a sidecar** in the Fly
app, Go exporting to `localhost:4318`, collector forwarding to Grafana Cloud
(eu-central-1). Grafana credentials live in collector config, not application code.

**Exit criteria — do not proceed until all three pass:**

1. A trace from production appears in Tempo, with correlated logs in Loki and a metric in
   Mimir, all filterable by `service.namespace=bigshop`.
2. Request latency is statistically unchanged versus before instrumentation. It should be
   — the Go export is a background batch, off the request path — and if it isn't,
   something is misconfigured.
3. **Failure injection**: point the collector at a blackholed endpoint and confirm the API
   keeps serving normally and drops telemetry silently. A dead collector must never be a
   retry storm or a request-path failure.

### Phase 3 — Widen the Go API, and the log cleanup

- Instrument every route via middleware rather than per-handler code.
- **Error-recording middleware at the Huma boundary**: `span.RecordError` +
  `span.SetStatus` on any returned error. Captures 100% of handler errors with no
  per-call-site work.
- Service layer stops logging and wraps instead: `fmt.Errorf("adding invite: %w", err)`.
- **Delete the 26 bare `log.Println(err)` calls** and every other line the span makes
  redundant. Convert only those carrying genuine extra context to `slog`. Net result is
  fewer lines than we started with.
- Fix `app/account.go:41` to preserve the real error.
- **Fix `/health` to `SELECT 1`.** It now backs a Fly health check, a Grafana synthetic
  check, and the `log.Fatalf`-on-init behaviour that currently masks the gap.
- Remaining metrics: import-outcome counter (source × result), LLM token counter
  (model × direction).

### Phase 4 — Next.js functions, and propagation

Instrument SSR and the four API routes via `instrumentation.ts`, and propagate
`traceparent` from `pages/api/dave/chat.ts` through `lib/dave/tools.ts` into the Go API —
so a Dave turn is one trace spanning both runtimes and every tool call.

**These are still Lambdas, so this is the one place a synchronous flush survives.** It
must be configured against the SDK's defaults, which are actively dangerous here — see
ADR-0007. Specifically: retries disabled, a ~250ms exporter timeout overriding the 10s
default, a bounded context on every `ForceFlush` (never `context.Background()`), the three
providers flushed **concurrently** rather than sequentially, and a package-level circuit
breaker that stops flushing after N consecutive failures for the rest of that container's
life.

Metrics only leave a Lambda on `ForceFlush` — the `PeriodicReader` never fires in a frozen
process — so the metrics flush is not optional on this side.

### Phase 5 — Browser

Grafana Faro for errors, logs and web vitals. **No browser spans and no propagation from
the client** — the backend hop is where the causality lives; browser tracing is where the
time goes. Private source map upload so stack traces de-minify.

### Phase 6 — Dashboards, and the uptime check

- A service dashboard per runtime, plus a Faro frontend view.
- **Grafana synthetic check on `/health`**, ~1/min, with one contact point. Free tier
  allows 100k API test executions/month.

Threshold-based alerting is deliberately **not** here — see `follow-ups.md` #36. It is
triggered by roughly two weeks of production data, not by a date.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **All three signals, correlated, from the start.** Not signal-by-signal.
- **100% sampling.** Head sampling would discard exactly the rare failure being
  investigated, and the volume does not require it.
- **Two export paths, deliberately asymmetric**: background batch from Go (long-lived
  process), synchronous bounded flush from the Netlify functions (still Lambdas). The
  awkward pattern is confined to four routes where it is proportionally noise.
- **Collector sidecar in the Fly app**, chosen over no collector. Credentials, redaction
  and routing move out of application code.
- **Grafana Cloud Free, eu-central-1, permanent.** One stack, shared across future
  projects via `service.namespace`. The region cannot be changed after creation.
- **Faro, not Sentry.** One platform; frontend sessions correlate with backend traces in
  one view. Accepts the loss of session replay, release-regression detection and any
  triage workflow.
- **Local LGTM in docker-compose for dev and e2e.** No Grafana Cloud credentials outside
  production; free-tier quota untouched by development.
- **Content and cardinality rules per ADR-0008**: pseudonymous IDs but no content, no
  unbounded metric labels, no service-layer logging.
- **No shared instrumentation library.** The reusable asset is the convention plus this
  repo as a worked reference. Revisit at project two.
- **Uptime check ships now; threshold alerts wait for baselines.**

## Explicitly out of scope

- Product analytics and any question with a horizon beyond 14 days — Google Analytics.
- Browser spans and client-to-server trace propagation.
- Profiling (Pyroscope), even though the local LGTM image includes it.
- Tail sampling, and any collector processing beyond redaction and forwarding.
- Extracting a shared Go module or npm package for instrumentation.
- Threshold-based alert rules — `follow-ups.md` #36.

## Things to get right when building this

- **Telemetry must never affect the application.** Exporter errors swallowed, flushes
  bounded, the SDK's default `ErrorHandler` replaced so it does not spam logs, and no
  telemetry initialisation that can `log.Fatal` the way `main.go`'s DB ping does.
- **Flush the three providers concurrently** on the Netlify side. Sequential is three
  round trips for no benefit — the single biggest avoidable cost in the design.
- **`account.id` belongs on spans, never on metrics.** ADR-0008 exists because this looks
  like an inconsistency and is not. Roughly 970 series against a 10k ceiling; adding
  account cardinality blows it.
- **Delta temporality on the Netlify metrics**, explicitly configured. Cumulative is the
  Prometheus default and is wrong for a process that dies constantly.
- Metrics on the Go side keep cumulative — it is a long-lived process, which is the case
  cumulative is designed for. The two runtimes differ here on purpose.
- `CONTEXT.md` gets **no changes**. Span, trace, exporter and temporality are general
  programming concepts, not Big Shop domain vocabulary, and the glossary explicitly
  excludes those.
- Adding a third compose service makes CLAUDE.md's multi-worktree
  `COMPOSE_PROJECT_NAME` trap slightly easier to fall into. The e2e stack already pins its
  own project name; check `dev-full.sh` does the right thing with the new service.
- Faro's source map upload needs wiring into the Netlify build, not just configured in
  Grafana.
