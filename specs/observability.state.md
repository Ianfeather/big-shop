---
spec: specs/observability.md
status: in-progress
branch: observability-phase4
pr: https://github.com/Ianfeather/big-shop/pull/95
---

Decisions and rationale live in [ADR-0007](../docs/adr/0007-observability-otel-grafana-cloud.md)
and [ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md). Sessions 1–7 map onto the
spec's Phases 1–6, with Phase 3 split across two Sessions and a preparatory Session 0 the spec
does not contain.

Corrections to the spec, applied by the Sessions below rather than by editing the spec. The
first four were agreed at planning time; the rest were forced by what the work turned up.

1. `go.opentelemetry.io/otel` v1.45.0 declares `go 1.25.0`; the module is on `go 1.23.0`. Hence
   Session 0. (User chose the bump over pinning otel to a ~18-month-old v1.35.x.)
2. The spec's "Grafana on 3000 — no clash, `dev-full.sh` serves the web app on 3001" is wrong:
   `scripts/dev-full.sh` defaults `WEB_PORT` to 3000 and only auto-increments on collision.
   Grafana gets its own `GRAFANA_PORT` (default 3200) instead.
3. There are five LLM-backed Next.js routes, not four: `parse-recipe-url`, `parse-recipe-text`,
   `parse-method-url`, `recipe-image`, `dave/chat`.
4. Phase 3's "remaining metrics" (import-outcome, LLM tokens) are relocated to Session 5. No Go
   file references OpenAI — every LLM call is in Next.js — and import *source* is never known to
   the Go API.
5. **e2e runs without telemetry** — decided during Session 1, not at planning time, and
   recorded here because it contradicts a spec decision line and an ADR sentence.
   `playwright.config.ts` passes `START_LGTM=false` and an empty
   `OTEL_EXPORTER_OTLP_ENDPOINT`. `grafana/otel-lgtm` is a ~1GB image running five services;
   nothing in `e2e/` asserts on telemetry, so the pull would be added to every CI run to prove
   nothing. ADR-0007 has been amended rather than left contradicting the code — the clause
   exists to protect the credential boundary, which holds either way.

## Session 0: Go toolchain 1.23 → 1.25
Status: done
Scope: Prerequisite for current OTel. Five pins — `netlify-functions/recipes/go.mod`,
`Dockerfile` and `Dockerfile.dev` build stages, `.github/workflows/ci.yml` `go-version`,
`netlify.toml` `GO_VERSION`. Huma stays at v2.35.0.
Depends on: none
Commit: 203de84
Notes: No Go toolchain on the host — all Go commands run inside the api container, per
`scripts/build-local.sh`, and in this worktree that needs
`COMPOSE_PROJECT_NAME=bigshop-obs DB_PORT=3310 API_PORT=8082` or compose resolves to the
*other* checkout's stack (CLAUDE.md's multi-worktree trap; `docker compose ls` showed project
`big-shop` running from `/Users/ianfeather/Repositories/big-shop`).

`go mod tidy` **removed** `toolchain go1.23.12` rather than bumping it — a toolchain line is
only retained when it names a version above the `go` directive. go.sum unchanged.

Test gate: `scripts/build-local.sh` green — gofmt, vet, full Go suite, and both the
openapi.yaml and api.d.ts drift checks.
Review gate: both axes clean on scope. Both independently caught one real miss —
`technical-architecture.md:306` still claimed Go 1.23 — now fixed. Also fixed, as judgement
calls: the stale go-1.23 rationale on the Huma pin in `follow-ups-resolved.md:17`, and a
netlify.toml comment of mine that mis-stated *why* tidy drops a redundant toolchain line.

## Session 1: Phase 1 — vertical slice against local LGTM
Status: done
Scope: `grafana/otel-lgtm` as a third docker-compose service (OTLP 4318, Grafana on
`GRAFANA_PORT:-3200`); verify `dev-full.sh` and `e2e/env.ts`'s `COMPOSE_PROJECT_NAME` isolation
still hold with a third service. `GET /recipes` instrumented end to end: resource attributes,
one server span (`account.id`, `user.sub`, route, status, `x-nf-request-id`), `otelsql` child
spans, `slog` via `otelslog`, the HTTP duration histogram. Telemetry init that cannot
`log.Fatal`; SDK `ErrorHandler` replaced.
Depends on: Session 0
Commit: ac89efc
Notes: Evidence is three Grafana screenshots under `specs/evidence/observability/`, showing
the trace's span attributes, its log line found by `trace_id`, and the duration histogram
labelled by route.

Test gate: `scripts/build-local.sh` green; `npm run test:e2e` 27/27. All three signals
verified against local LGTM by querying Tempo, Loki and Prometheus directly, not just by
observing that export succeeded.
Review gate: both axes clean on scope. Standards found two hard issues — every new dependency
left `// indirect` (`go mod tidy` had not been re-run) and ADR-0007 left asserting e2e uses
LGTM — plus three untrue comments, all fixed. Spec found the two gaps recorded above, plus a
path-keyed allow-list that would also have traced `POST /recipes`; now keyed on method and
route together.

**Known obstacle, found while planning:** the service layer calls `db.Query`/`db.Exec`/
`db.QueryRow` — 55 call sites, none of them the `*Context` variants — and takes no
`context.Context` at all (`GetAllRecipes(db *sql.DB, userID string)`). `otelsql` emits a child
span only when the call carries a context holding the parent span, so "otelsql child spans for
each query" is not a drop-in: it needs `ctx` threaded from the Huma handler into the service
function and the call switched to `QueryContext`. Session 1 does this for `GET /recipes`'s path
only; Session 3 carries it across the rest. Related to `follow-ups.md` #52, which counts 37
service functions taking a bare `*sql.DB`.

Pin `grafana/otel-lgtm:0.30.1` (matching the repo's habit of pinning `mysql:8.0`,
`air@v1.61.1`), not `latest`.

**Two Phase 1 items are knowingly incomplete, and Session 3 / Session 2 own them:**

- *"otelsql child spans for each query"* — `GET /recipes` runs two queries, and only one is
  spanned. `GetAllRecipes` was threaded to `QueryContext`, but it first calls
  `GetAccountID(db, userID)`, which has no context and is therefore suppressed by the
  SpanFilter (correctly — the alternative is a rootless span). Threading `GetAccountID` means
  21 call sites, 18 of which would take `context.Background()` because their own callers have
  no context either, and Session 3 would immediately rewrite all of them. Deferred to
  Session 3 rather than churned twice.
- *`service.version` (git sha)* — `version()` reads `SERVICE_VERSION`, and the Dockerfile now
  declares the build arg that carries it, defaulting to `unknown`. Nothing passes a real sha
  yet because nothing deploys yet: **Session 2 must add
  `--build-arg SERVICE_VERSION=$(git rev-parse --short HEAD)` to the Fly deploy**, or every
  production trace will claim to be `unknown`.

Two bugs found by reading telemetry back rather than trusting that export succeeded, both
recorded because they are the failure mode of this whole spec — instrumentation that looks
present and is wrong:
- Every query span carried `STATUS_CODE_ERROR` from `driver.ErrSkip`, which is fast-path
  negotiation, not a failure. Fixed with `DisableErrSkip`.
- `user.sub` was silently absent: the value was looked up with a same-shaped context key type
  declared in the telemetry package, and Go compares context keys by type as well as value.

## Session 2: Phase 2 — production, and the checkpoint
Status: done
Scope: OTel Collector as a sidecar in the Fly app; Go exports to `localhost:4318`; Grafana
credentials in collector config only. The three exit criteria: production trace + correlated
logs + metric; latency statistically unchanged; blackhole failure injection proving a dead
collector is a silent drop.
Depends on: Session 1
Commit: 5f94c8f (PR #93)

**Deployed 2026-08-11. Not verified.** Both machines run `['api', 'otelcol']`, 1/1, health
200; the collector started cleanly on both with no export errors (a bad credential would show
as a 401/403, and the config logs at `warn`, so failures are not being swallowed). The stray
probe container from the investigation is gone — this deploy cleared it by declaring
`containers` explicitly, which is the only thing that can.

**Exit criteria, as actually resolved:**
1. **Met.** A production trace was read back in Tempo: root `bigshop/bigshop-api GET /recipes`
   (77.65ms) with `sql.conn.query` and `sql.rows` beneath it, `Route /recipes`, 200. Confirmed
   by Ian, who has the Grafana access this side deliberately does not.
2. **Preliminary only.** No new per-request cost visible, but the measurement is weak (see
   below); not a controlled before/after.
3. **Not run.** Waived by Ian in favour of moving to Phase 3. Proven locally — the collector
   starts, stays up and logs nothing against a blackholed endpoint — but never demonstrated in
   production, which is what the spec asked for. Recorded as skipped rather than passed.

While diagnosing, one thing worth keeping: Tempo's search table can show
`<root span not yet received>` for a perfectly good trace. A span is exported when it *ends*,
and the root ends last, so children reach the index in an earlier batch than their parent. It
resolves itself. Single-span traces (e.g. a 401 that never touches the DB) never show it, which
makes it look like a pattern with meaning when it has none.

**Original notes, kept because they explain the shape of the work:**
1. *Trace in Tempo + logs in Loki + metric in Mimir.* Requires querying Grafana Cloud, whose
   credentials are Fly secrets scoped to the collector container and deliberately never seen by
   anyone working on the Go side. Needs a human with Grafana access, and an **authenticated**
   `GET /recipes` — unauthenticated 401s do produce spans (otelhttp wraps outside the auth
   middleware) but carry no `account.id`/`user.sub`, so they prove the pipeline and not the
   attributes. **Check `service.version` first**: a 7-char sha means the `--build-arg` wiring
   works, `unknown` means it silently didn't.
2. *Latency unchanged.* Preliminary only: `/recipes` 401s at 48–89ms against `/health` at
   44–60ms, both dominated by the network hop to Frankfurt. No new per-request cost visible,
   but this is weak evidence, not a measurement.
3. *Blackhole failure injection.* **Not done.** Proven locally; the spec asks for it in
   production, which means deliberately misconfiguring a working export and a deploy cycle.

Original blocking notes, kept for the record: **BLOCKED on the user.** Needs, before any of this session can run:
1. A Grafana Cloud Free stack (region is permanent — ADR-0007 picks eu-central-1/Frankfurt).
2. Its OTLP endpoint, instance ID and token, to be set with `fly secrets set` — never committed.
   **Use the names Grafana's own OpenTelemetry tile emits**, so its snippets and docs line up
   with what is actually set rather than needing translation at every reading:
   `GRAFANA_CLOUD_OTLP_ENDPOINT`, `GRAFANA_CLOUD_INSTANCE_ID`, `GRAFANA_CLOUD_API_KEY`.
   These are read by the *collector config only*. No Go code references them, and none should:
   the application knows about `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at `localhost:4318` and
   nothing about where the collector forwards to.
3. Go-ahead to deploy to production.

**Secrets are set** (confirmed by the user, 2026-08-10). Everything below the deploy line is
written and locally verified; what remains is the deploy itself and the three exit criteria.

Built and validated while blocked:
- `compose.fly.yml` — the two-container Machine definition, plus the collector config it
  carries. Validated with `otelcol validate` inside the real `0.158.0` image, then *run*
  against a blackholed endpoint: it starts, stays up, logs nothing and sits at ~36MB. That is
  exit criterion 3 rehearsed locally, though it still has to be demonstrated in production.
  Running it is what caught the `otlphttp` → `otlp_http` rename; `validate` alone passed it.
- `fly.toml` — `[build.compose]` replacing `dockerfile`, and `DEPLOY_ENV = "production"`.
- `deploy-api.yml` — passes `--build-arg SERVICE_VERSION` from the tested commit's sha.

**Implemented via `machine_config`, after a failed attempt with `[build.compose]`.**

`machine_config.json` defines two containers; `otel-collector.yaml` is the collector's config,
delivered as a real file through per-container `files`. Both validated *and run* in the real
`0.158.0` image before deploying — starts clean, silent, ~37MB against a 96MB limiter.

**The thing to know before touching secrets again:** a container receives ONLY the secrets its
`secrets` array names. `fly secrets set` alone does nothing for it, and the failure is silent —
the variable is simply absent, which for a credential means a feature that breaks only when
exercised. Adding a secret is a two-part change: set it, and declare it.

Found while doing this: **`SENDGRID_API_KEY` is not set on the Fly app at all**, though
`internal/pkg/app/user.go:149` reads it for invitation emails, and `fly.toml` claimed it was set
out-of-band. That flow is already broken, independently of any of this work. Not fixed here —
it needs a real key — but it must also be *declared* in `machine_config.json` when it is set.

**The deploy route is the pull request, not a manual `fly deploy`.** `deploy-api.yml` fires on
CI success against `master`, and deliberately refuses per-branch deploys ("dispatching from a
feature branch would otherwise push that branch straight onto the production machine, and
per-branch API deploys are explicitly out of scope"). So Phase 2's production checkpoint
cannot happen before Sessions 0–2 are merged — which inverts the spec's implied order, where
the checkpoint gates the widening. Sessions 3–7 therefore land in later PRs, after this one
has proved itself in production.

Researched while blocked:

- **The sidecar is achievable.** Fly supports multi-container Machines via a `[build.compose]`
  section in `fly.toml` naming a compose file; containers share a network namespace, so the Go
  process reaches the collector on `localhost:4318` exactly as ADR-0007 describes. Constraint:
  *exactly one* service in that compose file may specify `build` — every other must use a
  prebuilt image, which the collector does. The compose file must live in the build context
  (`netlify-functions/recipes/`) and be named explicitly, since Fly's auto-detection would
  otherwise find nothing there, and must not be confused with the repo-root `docker-compose.yml`
  that serves local development.
- **The collector's config needs a delivery mechanism.** It cannot be baked into an image
  (no `build` allowed for sidecars) and there is no host filesystem to mount from. The
  collector supports `--config=env:VAR`, so the whole YAML can travel as one Fly secret.
- **A wrinkle in ADR-0007's stated rationale, worth knowing before relying on it.** The ADR
  justifies the sidecar partly with "Grafana credentials live in collector config, not
  application code". On Fly, `fly secrets` are exposed to *every* container in a Machine and
  cannot be scoped to one service. So the separation is real at the level of *code* — nothing
  in the Go source references a Grafana credential — but not at the level of process
  environment. Not a reason to change the decision; a reason not to overstate it later.
- **`SERVICE_VERSION` must be passed at deploy** (see Session 1's notes), or every production
  trace claims to be `unknown`:
  `fly deploy ./netlify-functions/recipes --build-arg SERVICE_VERSION=$(git rev-parse --short HEAD)`
- **`DEPLOY_ENV=production`** needs setting in `fly.toml`'s `[env]`, or production telemetry
  arrives labelled `development` and is indistinguishable from a laptop's in the same Tempo.

### Correction 6 — `/health` stays as it is

The spec's Phase 3 says **"Fix `/health` to `SELECT 1`"**, and its "Current state" calls the
present check "a health check that checks nothing". Ian decided against it on 2026-08-11:
`/health` should answer only "is this machine up and the Go process serving", and database
connectivity should be observed through telemetry rather than through a health check.

**Why this is the better answer, now:** `/health` backs a *Fly health check*. Making it depend
on TiDB means a database outage causes Fly to fail health checks and start cycling machines
that are themselves perfectly healthy — turning a degraded dependency into a restart storm, and
removing the one thing still able to serve cached or non-DB responses. The spec's complaint was
that a warm container with a dead database looks fine; the answer to that is a metric and an
alert, which is what the rest of this spec builds.

Also worth recording, because it makes the check less empty than the spec implies: `main.go`
`log.Fatalf`s on a failed DB ping during init, so a process that is serving at all did reach
the database at startup. What is missing is only the *continuous* signal — and that is
telemetry's job.

### Correction 7 — two carve-outs in Session 3, both deliberate

- **`/health` is not traced.** The spec says "instrument every route via middleware". Every
  route is, bar this one: Fly polls it every 30s per machine and Session 7 adds a Grafana
  synthetic check at ~1/min, so tracing it would add thousands of identical spans a day and
  drag the duration histogram's p99 towards the cost of a health check rather than of a
  request.
- **`span.SetStatus` fires only on 5xx**, though `span.RecordError` fires on every returned
  error. The spec says "`span.RecordError` + `span.SetStatus` on any returned error". A 404 for
  a Recipe that does not exist is the API working; marking those spans failed would make "show
  me the errors" mean "show me the traffic". The cause is still recorded and readable — only
  the red flag is withheld.

## Session 3: Phase 3a — widen the Go API
Status: done
Scope: every route instrumented via middleware rather than per-handler code; error-recording
middleware at the Huma boundary (`span.RecordError` + `span.SetStatus`);
`internal/pkg/app/account.go` stops discarding the real error at **both** sites (`:41` and
`:69` — the spec names only one); and `ctx` threaded through the service layer so `otelsql`
spans every query rather than only `/recipes`. **`/health` is deliberately not changed** — see
correction 6.
Depends on: Session 2
Commit: ce2549e (squashed into b98f16b, PR #94)
Notes: Verified against local LGTM by reading traces back, not by assuming export worked.
Every route now carries DB child spans where before only `/recipes` did, and only one of its
two queries: `/shopping-list` 30 sql spans, `/recipe/{id}` 12, `/account` 8, `/user` 4,
`/tags`/`/units`/`/ingredients` 2 each. `/health` produces none. `http_route` label values are
exactly the registered templates plus `unmatched`.

Test gate: `scripts/build-local.sh` green (four Go packages, both drift checks);
`npm run test:e2e` 27/27.
Review gate: two real defects caught and fixed before commit, both of which had gone live the
moment the allow-list came off — an unbounded/content-carrying `http.route` (slugs and
unregistered paths), and `huma.Error500InternalServerError(msg, err)` serialising the cause to
the client while *not* recording it on the span. Also fixed: three comments that had become
false, `db.Begin` → `BeginTx`, and a bare `500`.

### Correction 8 — where the removed logging actually went

The spec says "Convert only those carrying genuine extra context to `slog`". Nothing was
converted to slog. Two substitutions were made instead:

- **Span events, not slog, for the four best-effort failures** (catalog enrichment, shopping-
  list history). Their callers deliberately ignore the error, so there is nothing to wrap and
  return; `telemetry.RecordWarning` attaches the fact to the request's span. This keeps the
  service layer free of logging entirely, which ADR-0008 §3 asks for and slog would not have.
- **`main.go` and `internal/pkg/purge/purge.go` keep stdlib `log`** — 11 lines. Startup and
  fatal messages happen before any request exists, and the purger is a detached fire-and-forget
  goroutine with no request context, so in both cases there is no span to attach to and no
  trace_id to correlate by. The consequence, worth stating: those lines reach Fly's log stream
  and never Loki. A purge that silently stops working is therefore still invisible in Grafana —
  a real gap, and a candidate for `follow-ups.md` rather than for widening this session.

### Correction 9 — the spec's log counts were measured with the wrong instrument

The spec says "70 `log.*` calls ... 26 of them a bare `log.Println(err)`", and earlier notes
here corrected that to 87/27. All three counts only ever matched `log.*`. The service layer
also had **21 `fmt.Print*` calls**, including — on the invite path —

```go
fmt.Println(email)
fmt.Println(token)
```

An email address is named in ADR-0008 §1 as excluded by rule, and an invite token is a bearer
credential; both were being written to stdout, which on Fly is the log stream. Found by review,
not by the counting. Session 4 removes all 21.

## Session 4: Phase 3b — the log cleanup
Status: done
Scope: delete the bare `log.Println(err)` calls and everything else the span makes redundant;
service layer stops logging and wraps errors per ADR-0008 §3; convert only genuinely-extra-
context lines to `slog`. Net fewer lines than we started with.
Depends on: Session 3
Commit: 89cbb1c (squashed into b98f16b, PR #94)
Notes: Verified end to end against local LGTM by stopping the database and reading the trace
back: root `GET /recipes` with `STATUS_CODE_ERROR` and two exception events — the wrapped cause
(`getting account ID: dial tcp: lookup db ... no such host`) and what the client was told
(`Failed to get recipes from db`) — while the HTTP body carried only the opaque message.

Final state: 0 log/print calls in `internal/pkg/service`, 0 `fmt.Print*` anywhere in
`internal/`, 11 stdlib `log` calls left in `main.go` and `purge.go` (correction 8). Net −31
lines across the session.

Test gate: `scripts/build-local.sh` green; `npm run test:e2e` 27/27.
Review gate: both axes blocked on the same finding — 21 `fmt.Print*` calls the `log.*` count
could not see, two of them writing an invite email and token to stdout (correction 9). Also
fixed: `fail()` classifying span errors by client status rather than cause, a wrapped
`sql.ErrNoRows` plus the `==` comparison that would have broken on it, four wrap-text defects,
and ten `%v` formats in `history.go` that never wrapped.

Split from Session 3 on purpose — 17 files, far easier to review once the spans that
justify each deletion already exist. Spec's counts (70/26) were stale; actual is 87/27.

## Session 5: Phase 4 — Next.js functions and propagation
Status: done
Scope: `instrumentation.ts` for SSR and all five API routes; `traceparent` propagated from
`pages/api/dave/chat.ts` through `lib/dave/tools.ts` into the Go API. Retries disabled, ~250ms
exporter timeout, bounded context on every `ForceFlush`, three providers flushed concurrently,
package-level circuit breaker, delta temporality. Plus the two relocated metrics: import-outcome
(source × result) and LLM tokens (model × direction).
Depends on: Session 4
Commit: 26ce489 + 596b03d (PR #95)
Notes: Verified against local LGTM by reading all three signals back, not by observing that
export succeeded. A Dave turn is **one** trace across both runtimes — Next's server span ->
`POST /api/dave/chat` -> `dave.tool search_recipes` -> `bigshop-api GET /recipes` (with
`account.id`) -> four `otelsql` spans, 13 spans in one trace id. An import is likewise one
trace: route span -> `GET /ingredients` and `GET /units` on the Go API with their SQL beneath
-> `openai extract_recipe`. Both counters arrived with exactly their designed label sets
(`source`×`result`, `model`×`direction`, no `account.id`), and a log line reached Loki carrying
the `trace_id` and `span_id` of the request that wrote it, resolving to that request's span in
Tempo.

Test gate: `npm run test` 220/220 (22 of them new, covering the flush and breaker, the metric
label discipline, and the route wrapper); `npm run typecheck`, `npm run lint`, `npm run build`;
`scripts/build-local.sh` green; `npm run test:e2e` 27/27.

Review gate: **four real defects, three of them in code that was already verified working
against LGTM** — a reminder that "the trace looked right" and "the code is right" are different
claims.

1. **The flush could reject into a request handler.** The three `forceFlush()` calls were
   evaluated one line above the `try`, so a provider throwing *synchronously* escaped
   `flushTelemetry()` — and `api-route.ts` awaits it in a `finally`, where a rejection replaces
   the handler's outcome. A telemetry fault would have turned a perfectly good 200 into a 500,
   which is the precise failure ADR-0007's first rule exists to prevent. `Promise.allSettled`
   is no help: the throw happens while its argument array is still being built. The existing
   test missed it by using an `async` function, which converts a throw into a rejection.
2. **`JSON.parse` puts the content it was parsing into its error message**, and that message
   reached `recordException`. On these paths the parsed content is model output or a Go API
   response body, so a failed extraction would have written recipe text onto a span — reversing
   ADR-0008 §1 on the exact failure §1 is written about ("the response body *is* the evidence,
   and it will not be in the trace"). Demonstrated rather than assumed: `JSON.parse('{"name":
   Sunday Roast Potatoes}')` gives `Unexpected token 'S', "{"name": Sunday Roa"...`. Now
   scrubbed in `span.ts`'s `safeError`, at the one boundary where an error becomes telemetry,
   rather than at each `JSON.parse` — a rule that must be remembered at every future parse is a
   rule that will be broken at one of them.
3. **`x-nf-request-id` was missing**, though the spec names it under "things to get right" and
   the Go middleware already sets it. These five routes *are* the Netlify functions, so it
   matters here at least as much. Added as `netlify.request_id`, spelled to match
   `telemetry/http.go:106` — two spellings would be two perfectly good attributes and one
   unwritable query.
4. **`recipe-image.ts` counted user-input 400s as errors.** Its outer `catch` recorded
   `'error'` and reddened the span before branching to "no image provided" / "not an image" /
   "over 5MB" — undoing, one file away, the discipline `api-route.ts` sets out in its own
   header comment. `ImportResult` gains a fourth value, `rejected`, so those stay countable
   without polluting the error rate.

Also fixed: an unterminated detached promise chain in `recipe-image.ts` (a rejection in the
background job's `.catch` would have been an unhandled rejection, which kills the Node process);
a `FLUSH_TIMEOUT_MS` comment that said "much smaller than three" exporter timeouts directly
above `3 * EXPORT_TIMEOUT_MS`; the `error instanceof Error ? … : new Error(String(…))` dance
repeated at six sites, now `safeError`; and `LoggerName` in PascalCase among a file of
SCREAMING_SNAKE constants.

Correction 11 was **rewritten** rather than defended: review was right that its second clause
("buys Next.js's own spans for free") contradicted correction 12 in the next breath.

**Production is wired in code but not in configuration — and this needs Ian.** Unlike the Go
API, these functions have no collector sidecar to hold credentials: ADR-0007 has them exporting
OTLP straight to Grafana Cloud. So nothing leaves Netlify until two variables are set in the
Netlify UI (site configuration → environment variables), and until they are, `enabled()` returns
false and the SDK never starts — which is the designed behaviour, not a failure:

- `OTEL_EXPORTER_OTLP_ENDPOINT` — the Grafana Cloud OTLP endpoint (`.../otlp`), the same one
  behind `GRAFANA_CLOUD_OTLP_ENDPOINT` on Fly.
- `OTEL_EXPORTER_OTLP_HEADERS` — `Authorization=Basic <base64 of instanceID:token>`. Read by the
  SDK itself, so no Go or TypeScript references it.

`service.version` needs nothing: it falls back to Netlify's own `COMMIT_REF`. `CONTEXT` gives
`deployment.environment.name` for free, and distinguishes a deploy preview from production
rather than folding both into one label.

**Once set, the check worth making first** is the same one Session 2 recommends: filter
`service.name=bigshop-web` in Tempo and confirm a Dave turn and an import each arrive as one
trace rather than several, and that `service.version` is a real sha rather than `dev`.

### Correction 10 — retries cannot be disabled in this SDK, and do not need to be

ADR-0007 requires `WithRetry(RetryConfig{Enabled: false})` on the Netlify exporters, because
the process is about to freeze and there is no second attempt to be alive for. That is the Go
exporter's API. **The JS OTLP exporter's retry policy is mandatory and has no off switch** — 5
attempts, 1s initial backoff, 1.5x multiplier — but it is explicitly bounded by
`timeoutMillis`. So `EXPORT_TIMEOUT_MS` caps total time spent whether the SDK retries or not,
which is the property the ADR actually wanted. One number, doing the job of two.

### Correction 11 — there is no production SSR to instrument

The spec says "instrument SSR and the four API routes". The only `getServerSideProps` in the
whole app are in `pages/dev/api-docs.tsx` and `pages/dev/design-system.tsx`, both of which
`notFound` outside development; everything else is client-rendered through TanStack Query.
**Nothing was skipped because there is nothing there** — that reason, on its own, is what
settles this one.

An earlier draft of this correction added that registering a provider "buys Next.js's own
render and route-dispatch spans for free". Review caught that as an overclaim, and it is:
correction 12 says in the next breath that nothing outside `withTelemetry` flushes, so on a
frozen Lambda those spans are buffered and lost. Free to *emit*, not free to *deliver*. If SSR
data fetching ever arrives in this app it will need a flush of its own, and that is a Session
of its own rather than something this one quietly covered.

(Also: five routes, not four. That was already correction 3.)

### Correction 12 — Next.js's own root span is not in the flush

Registering a provider means Next emits its own spans, and its outermost one
(`BaseServer.handleRequest`) is the trace's *root*. It ends strictly **after** the handler
returns, so it is not in the `ForceFlush` the handler performs. Locally this is invisible —
the dev server keeps running and the batch processor's timer fires — but on a frozen Lambda
that root will lag until the next invocation on the same container, or be lost with it.

Left as is rather than worked around, because the span that carries the load is ours: route,
status, `account.id`, the recorded cause, and the whole subtree of tool/LLM/Go-API spans hang
off it, and it *is* flushed. A missing root costs the trace list a tidy title, not its content.
Worth knowing before reading a production trace and concluding something is broken.

### Correction 13 — propagation goes further than the spec names

Phase 4 names `lib/dave/tools.ts`. Reading the first traces back showed why that is not
enough: `lib/recipe-import/known-names.ts` and `lib/authenticate.ts` also call the Go API from
these functions, so **every import produced two orphan `bigshop-api` traces** (`GET
/ingredients`, `GET /units`) and every authenticated route one more (`GET /account`), while the
import's own trace had a hole where the catalog lookup should be. All three now propagate; the
import trace above is what that fixed. `lib/api-host.ts` already names exactly these three as
the server-side callers, which is a good sign the set is complete.

### Correction 14 — local LGTM silently drops the delta metrics

ADR-0008 §2 requires delta temporality from this runtime. **The `grafana/otel-lgtm` image's
Prometheus rejects delta points and logs nothing about it**, so both new counters were absent
locally while the Go API's cumulative metrics arrived perfectly — a convincing impression of an
instrumentation bug, and one that cost real time here. `docker-compose.yml` now passes
`PROMETHEUS_EXTRA_ARGS=--enable-feature=otlp-deltatocumulative`. Grafana Cloud accepts delta,
so this is a local-stand-in gap rather than anything about production.

### Correction 15 — the logs signal was installed and unused, so it was made real

`setup.ts` installs a LoggerProvider and `flush.ts` flushes it, but nothing on this side writes
through the OTel logs API: the routes put failures on the span, per ADR-0008 §3. That would
have shipped a third of ADR-0007's "all three signals" as scaffolding.

`lib/telemetry/log.ts` bridges the six remaining server-side `console.error` calls in `lib/`.
They are the right ones to keep as logs rather than fold into spans: each says a *deployment*
is misconfigured (`API_HOST_INTERNAL` unset, the catalog lookup unreachable), which is not a
fact about the request that happened to trip over it. They still write to the console too, so a
misconfiguration message does not vanish when the misconfigured thing is telemetry.

### Correction 16 — the circuit breaker has a sharp edge in local development

The breaker stops flushing after three consecutive failures for the rest of the container's
life, and relies on **container churn** as its reset — which is correct on Lambda and wrong for
`next dev`, a process that lives for hours. Restarting the LGTM container mid-session opened
the breaker permanently and produced exactly the symptom being debugged at the time: traces
already exported, no new telemetry, nothing logged. Found the hard way. Not worth a cooldown
timer for production's sake; worth knowing that **restarting LGTM means restarting `next dev`**.

### Correction 17 — Photo Import's background work, and what it means for its telemetry

`pages/api/recipe-image.ts` answers 202 and extracts in a detached promise, so its outcome
counter and token count are recorded and flushed *after* the request's own flush, in that same
promise. Whether any of it runs on a frozen Lambda is a property of Netlify's function wrapper
that this session did not establish. Instrumented as well as it can be — its own
`flushTelemetry()` in a `.finally` — and filed as `follow-ups.md` #55 rather than fixed, since
making the extraction reliable changes how Photo Import works rather than how it is observed.

### Correction 18 — no `user.sub` on this runtime's spans

The Go API's spans carry `account.id` and `user.sub`. These routes carry only `account.id`:
`lib/authenticate.ts` establishes who the caller is by asking the Go API which Account the token
resolves to, and the answer is an id. Adding the subject would mean decoding a JWT this runtime
deliberately does not validate.

## Session 6: Phase 5 — browser
Status: pending
Scope: Grafana Faro for errors, logs and web vitals. No browser spans, no client propagation.
Private source map upload wired into the Netlify build, not just configured in Grafana.
Depends on: Session 5
Commit:
Notes: Evidence is browser-side — a thrown error in Faro with a de-minified stack.

## Session 7: Phase 6 — dashboards and the uptime check
Status: pending
Scope: a service dashboard per runtime plus a Faro frontend view; Grafana synthetic check on
`/health` at ~1/min with one contact point.
Depends on: Session 6
Commit:
Notes: No threshold alert rules — `follow-ups.md` #37, triggered by ~two weeks of production
data rather than by a date.
