# Observability: OpenTelemetry to a Grafana Cloud stack in eu-central-1

Status: accepted

Big Shop emits traces, metrics and logs via OpenTelemetry, correlated by `trace_id`, to a
Grafana Cloud Free stack in **AWS eu-central-1 (Frankfurt)**. Sampling is 100%. Grafana
Faro covers the browser for errors and web vitals. OpenTelemetry rather than a vendor SDK
is deliberate: the instrumentation is the durable asset and the backend should stay
swappable, since Grafana Cloud Free is a starting point rather than a commitment.

Long-horizon product questions ("is Dave used more than three months ago") are explicitly
**out of scope** and belong to Google Analytics. That is what makes Grafana Cloud Free's
14-day retention a non-issue rather than a constraint.

## Two export paths, because there are two runtimes

**The Go API (Fly.io, Frankfurt)** exports through an OpenTelemetry Collector running as a
sidecar in the same Fly app, over `localhost:4318`. Because the process is long-lived, the
SDK's batch processor exports in the background, entirely off the request path — there is
no flush, no cold start cost and no per-request latency. Redaction, sampling policy and
the Grafana credentials live in collector config rather than in application code.

**The Next.js functions (Netlify, us-east-2)** are still Lambdas, so they still export
directly over OTLP/HTTP with a bounded synchronous `ForceFlush` before returning. A
Lambda's execution environment freezes the instant the handler returns, so anything still
buffered is lost; there is no "after the response" available. This applies to four
LLM-backed routes whose latency is dominated by OpenAI calls measured in seconds, so a
flush is proportionally noise.

That asymmetry is the point: the awkward pattern is confined to the four routes where it
does not matter, rather than applied to the whole API. See
[ADR-0006](./0006-go-api-leaves-netlify-functions.md).

**Local development** uses `grafana/otel-lgtm` in `docker-compose.yml` — Collector,
Tempo, Loki, Prometheus and Grafana in one image — exporting to `localhost:4318`. Grafana
Cloud credentials therefore exist only in Fly and Netlify production config, development
noise never touches the free-tier quota, and the feedback loop while writing
instrumentation is sub-second.

**e2e does not run it.** This clause originally read "Local development and e2e", and the
e2e half was dropped when it was implemented: `playwright.config.ts` passes
`START_LGTM=false` and an empty `OTEL_EXPORTER_OTLP_ENDPOINT`, so neither the container nor
the SDK inside the Go API starts. `grafana/otel-lgtm` is a ~1GB image running five
services, and nothing in `e2e/` asserts on telemetry — that pull would be added to every CI
run to prove nothing. What this clause exists to protect is the credential boundary, which
holds either way: there is still no Grafana Cloud credential outside production. Revisit if
an e2e test ever needs to assert on emitted telemetry.

## The Netlify flush has dangerous defaults

Recorded because a future reader will see the configuration and assume it is a mistake.
The Go OTLP HTTP exporter defaults to `retry.DefaultConfig` (**retries enabled**,
exponential backoff, one-minute elapsed cap) and a **10 second per-attempt timeout**. Left
alone, an unreachable Grafana endpoint means every Netlify function request blocks until
the platform timeout — *Grafana Cloud going down would take Big Shop down*. So:

- `WithRetry(RetryConfig{Enabled: false})` — the process is about to freeze; there is no
  second attempt to be alive for.
- `WithTimeout(~250ms)`, overriding the 10s default. Not shorter: below the cost of one
  reconnect, a stale keep-alive would drop telemetry every time.
- A bounded `context.WithTimeout` on every `ForceFlush`, never `context.Background()`.
- A package-level circuit breaker: after N consecutive failures, stop flushing for the
  rest of that container's life. Containers persist across invocations, so one that has
  learned the endpoint is down stops paying the timeout; new containers re-probe, so it
  self-heals with no cooldown logic.

The same principle applies to the Go sidecar: a dead collector must be a silent drop, not
a retry storm.

**Telemetry must never affect the application.** Exporter errors are swallowed, the SDK's
default `ErrorHandler` is replaced so it does not spam function logs, and no telemetry
initialisation may `log.Fatal` the way `main.go`'s DB ping currently does.

## Why eu-central-1

The stack sits in the same metro as the Go API and the same AWS region as TiDB. Because
the Go export is a background batch, its distance to Grafana is close to irrelevant —
which means the region was chosen for residency and coherence rather than latency. An
earlier draft of this decision chose us-east-2 to co-locate with what were then
Lambda-hosted Go handlers paying a synchronous flush; ADR-0006 removed that constraint
entirely.

Worth stating precisely, since "everything is in Frankfurt" is a convenient shorthand that
hides a boundary: Grafana Cloud and TiDB are both on AWS `eu-central-1`, while the Go API
runs on Fly's own hardware in the same metro. The Go-to-Grafana export therefore crosses a
provider boundary — which is why it being a background batch, rather than anything on a
request path, is load-bearing rather than incidental.

**This is permanent.** Grafana Cloud does not support changing an existing stack's region,
and the free tier allows one stack — so this governs every future project sharing it.
Revisit only by creating a second account.

## Consequences

- Multi-project tenancy on one stack comes from resource attributes, not separate stacks:
  `service.namespace` per project, `service.name` per runtime (`bigshop-api`,
  `bigshop-web`, `bigshop-browser`), plus `deployment.environment.name` and
  `service.version`.
- Metrics only leave a Lambda on `ForceFlush` — the `PeriodicReader` never fires in a
  frozen process — so the metrics flush is not optional on the Netlify side.
- The browser path is genuinely fire-and-forget; Faro cannot affect page behaviour.
- No shared instrumentation library is extracted. The reusable asset is this convention
  plus Big Shop as a worked reference, on the grounds that an abstraction derived from one
  example is usually wrong at the joints.
