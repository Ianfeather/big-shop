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
Status: pending
Scope: `grafana/otel-lgtm` as a third docker-compose service (OTLP 4318, Grafana on
`GRAFANA_PORT:-3200`); verify `dev-full.sh` and `e2e/env.ts`'s `COMPOSE_PROJECT_NAME` isolation
still hold with a third service. `GET /recipes` instrumented end to end: resource attributes,
one server span (`account.id`, `user.sub`, route, status, `x-nf-request-id`), `otelsql` child
spans, `slog` via `otelslog`, the HTTP duration histogram. Telemetry init that cannot
`log.Fatal`; SDK `ErrorHandler` replaced.
Depends on: Session 0
Commit:
Notes: Evidence is Grafana screenshots showing trace → logs → metric correlating.

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

## Session 2: Phase 2 — production, and the checkpoint
Status: pending
Scope: OTel Collector as a sidecar in the Fly app; Go exports to `localhost:4318`; Grafana
credentials in collector config only. The three exit criteria: production trace + correlated
logs + metric; latency statistically unchanged; blackhole failure injection proving a dead
collector is a silent drop.
Depends on: Session 1
Commit:
Notes: **Will block on the user** — needs a Grafana Cloud Free stack in eu-central-1 (permanent
per ADR-0007), its OTLP endpoint/instance ID/token set as `fly secrets`, and go-ahead to deploy.

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
