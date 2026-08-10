---
spec: specs/observability.md
status: in-progress
branch: observability
pr:
---

Decisions and rationale live in [ADR-0007](../docs/adr/0007-observability-otel-grafana-cloud.md)
and [ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md). Sessions 1–7 map onto the
spec's Phases 1–6, with Phase 3 split across two Sessions and a preparatory Session 0 the spec
does not contain.

Four corrections to the spec, agreed at planning time and applied by the Sessions below rather
than by editing the spec:

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
Status: blocked
Scope: OTel Collector as a sidecar in the Fly app; Go exports to `localhost:4318`; Grafana
credentials in collector config only. The three exit criteria: production trace + correlated
logs + metric; latency statistically unchanged; blackhole failure injection proving a dead
collector is a silent drop.
Depends on: Session 1
Commit:
Notes: **BLOCKED on the user.** Needs, before any of this session can run:
1. A Grafana Cloud Free stack (region is permanent — ADR-0007 picks eu-central-1/Frankfurt).
2. Its OTLP endpoint, instance ID and token, to be set with `fly secrets set` — never committed.
3. Go-ahead to deploy to production.

Researched while waiting, so the session can move immediately once unblocked:

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

## Session 3: Phase 3a — widen the Go API
Status: pending
Scope: every route instrumented via middleware rather than per-handler code; error-recording
middleware at the Huma boundary (`span.RecordError` + `span.SetStatus`); `/health` becomes a
real `SELECT 1`; `internal/pkg/app/account.go:41` stops discarding the real error.
Depends on: Session 2
Commit:
Notes:

## Session 4: Phase 3b — the log cleanup
Status: pending
Scope: delete the 27 bare `log.Println(err)` calls and everything else the span makes redundant;
service layer stops logging and wraps errors per ADR-0008 §3; convert only genuinely-extra-
context lines to `slog`. Net fewer lines than we started with.
Depends on: Session 3
Commit:
Notes: Split from Session 3 on purpose — 17 files, far easier to review once the spans that
justify each deletion already exist. Spec's counts (70/26) were stale; actual is 87/27.

## Session 5: Phase 4 — Next.js functions and propagation
Status: pending
Scope: `instrumentation.ts` for SSR and all five API routes; `traceparent` propagated from
`pages/api/dave/chat.ts` through `lib/dave/tools.ts` into the Go API. Retries disabled, ~250ms
exporter timeout, bounded context on every `ForceFlush`, three providers flushed concurrently,
package-level circuit breaker, delta temporality. Plus the two relocated metrics: import-outcome
(source × result) and LLM tokens (model × direction).
Depends on: Session 4
Commit:
Notes:

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
