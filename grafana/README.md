# Grafana dashboards

Phase 6 of [`specs/observability.md`](../specs/observability.md). Three dashboards, checked in as
JSON.

**Why they live in the repo rather than only in Grafana.** A dashboard built by clicking exists in
exactly one place and is gone with the stack. These are reviewable in a pull request, restorable
after a mistake, and — more usefully — they carry their reasoning: every panel has a description
saying what it is for and, where it matters, why the query is shaped the way it is.

| File | What it answers |
|---|---|
| `dashboards/bigshop-health.json` | **The one to open when something looks wrong.** Is anything broken, what failed, what is slow. Spans both backend runtimes. |
| `dashboards/bigshop-api.json` | The Go API on Fly: routes, latency, and the database work underneath. |
| `dashboards/bigshop-web.json` | The Netlify functions: Import outcomes, what the AI costs, Dave turns end to end. |

The browser is deliberately **not** a hand-built dashboard — see "Faro" below.

## Importing

Dashboards → New → Import → paste the file's contents → pick your Prometheus, Loki and Tempo
datasources when prompted.

The datasources are template variables rather than hard-coded UIDs, so the same JSON imports into
any stack, including a local `grafana/otel-lgtm` (where these were built and verified).

Re-importing an edited file overwrites the existing dashboard, because each carries a stable `uid`.
**If you change a dashboard in the UI, export it back to this directory**, or the next import
silently reverts your change.

## Two query decisions worth knowing before editing a panel

**Counts use `last_over_time`, not `increase()`.** This is not a stylistic preference. At Big Shop's
traffic a status code often has a single sample in the window, and `increase()` *silently drops
single-sample series* while extrapolating the rest — measured here turning one 400 into five and one
500 into nothing at all. A health panel that answers "0 errors" when the answer is 1 is worse than
no panel. The cost is that these are running totals rather than windowed ones; with 14-day retention
that is close enough, and the graphs show when the number moved.

**TraceQL metrics panels are pinned to a 3-hour window** with a panel-level time override, and
grouped with `by (name)`. Tempo rejects TraceQL metrics queries over long ranges — measured failing
at 24h, succeeding at 6h — so without the override they error on every load of a dashboard that
defaults to 24 hours. The grouping is because TraceQL metrics frames are all named `rate`, and
neither `legendFormat` nor a `byFrameRefID` override renames them; grouping by span name makes each
series label itself.

## Faro / the browser

There is no hand-built browser dashboard. Grafana Cloud's **Frontend Observability** app is
purpose-built for Faro data — errors, web vitals, sessions, source-mapped stack traces — and
anything assembled here would be a worse version of it. The health dashboard links to it.

## The synthetic check — not automated, and it needs you

The spec asks for a Grafana synthetic check on `/health` at roughly 1/minute. It is **not** created
by this repo, and cannot be: it lives in Grafana Synthetic Monitoring, which has its own API and
token, and its contact point is a decision about where alerts go rather than a value to commit.

To set it up: Testing & Synthetics → Checks → Add check → **HTTP**.

- **Target**: `https://big-shop-api.fly.dev/api/bigshop/health`
- **Frequency**: 60s
- **Probes**: one or two European probes. More probes means more executions against the free tier's
  100k/month, and one is enough to know the API is up.
- **Valid status codes**: 200

Point it at the **Fly origin directly, not `www.bigshop.life/api/bigshop/health`.** The Netlify
rewrite would make a Netlify outage look identical to an API outage, and the whole point of this
check is to tell them apart.

Note what this check does and does not prove. `/health` returns `ok` without touching the database —
deliberately, per Phase 3's correction 6: making a Fly health check depend on TiDB turns a database
outage into a machine-restart storm. So a green check means "the machine is up and the Go process is
serving", not "the app works". The dashboards are what tell you the latter.

Threshold-based alerting is deliberately out of scope — `follow-ups.md` #37 wants roughly two weeks
of production data first, so the thresholds are chosen against reality rather than guessed.
