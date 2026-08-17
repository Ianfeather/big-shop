// Wires the OpenTelemetry SDK up for the Next.js runtime: traces, metrics and
// logs, all three exported over OTLP/HTTP to whatever collector
// OTEL_EXPORTER_OTLP_ENDPOINT names.
//
// Decisions live in docs/adr/0007-observability-otel-grafana-cloud.md; what the
// telemetry deliberately does not carry lives in docs/adr/0008. The one rule
// that governs every line of this file, exactly as it governs its Go sibling in
// netlify-functions/recipes/internal/pkg/telemetry: **telemetry must never
// affect the application.** Nothing here throws, nothing here logs on an export
// failure, and setup on a machine with no collector is a no-op rather than a
// problem.
//
// This is the *Lambda* side of ADR-0007's deliberately asymmetric design. The
// Go API is a long-lived process that exports in the background and never
// flushes; these functions freeze the instant the handler returns, so they
// export synchronously under a bound before that happens. See flush.ts, which
// is where the awkward half of that asymmetry actually lives.

import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { setGlobalErrorHandler } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// The OTel service.name for this runtime. ADR-0007's tenancy model is one
// Grafana stack shared across projects, separated by service.namespace, with
// service.name naming the runtime within a project - bigshop-api for the Go
// process, bigshop-web here, bigshop-browser in Phase 5.
export const SERVICE_NAME = 'bigshop-web';

// Separates this project from any other sharing the free-tier stack. It is the
// attribute every dashboard and every "is this us?" query filters on.
export const NAMESPACE = 'bigshop';

// Name of the meter and tracer this runtime emits under.
export const INSTRUMENTATION_SCOPE = 'bigshop-web';

// Labels log records emitted through the bridge in log.ts. Named to match the
// Go side's LoggerName, which is 'recipes' for the same reason: it names the
// emitting component within the service rather than repeating the service.
export const LOGGER_NAME = 'web';

// The per-attempt export timeout, overriding the SDK's 10 second default.
//
// ADR-0007 calls the default actively dangerous here, and it is: left alone, an
// unreachable Grafana endpoint means every one of these functions blocks for ten
// seconds before returning, so *Grafana Cloud going down would take Big Shop
// down*. 250ms is chosen from below as well as above - shorter than the cost of
// one TCP reconnect and a stale keep-alive would drop telemetry every time.
//
// **In this SDK the timeout is the whole story, which it is not in Go.** ADR-0007
// also asks for retries to be disabled, because the process is about to freeze
// and there is no second attempt to be alive for. The Go exporter takes
// `WithRetry(RetryConfig{Enabled: false})`; the JS exporter's retry policy is
// mandatory and has no off switch (5 attempts, 1s initial backoff, 1.5x
// multiplier). It is, however, explicitly bounded by `timeoutMillis` - so this
// one number caps total time spent whether the SDK retries or not, which is the
// property the ADR actually wanted. See the Phase 4 correction in
// specs/completed/observability.state.md.
export const EXPORT_TIMEOUT_MS = 250;

// Enabled reports whether telemetry will actually be set up.
//
// The presence of OTEL_EXPORTER_OTLP_ENDPOINT is the switch, rather than a
// dedicated flag, because it is the one thing that must be true for export to
// work at all - so there is no way to be "enabled" and misconfigured. Vitest,
// the e2e suite and a production deploy that has not been given an endpoint all
// set nothing, and therefore get no SDK, no background timers and no connection
// attempts. Identical to the Go side's Enabled().
export function enabled(): boolean {
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

// The three providers, held where flush.ts can find them again.
export interface Providers {
  tracerProvider: NodeTracerProvider;
  meterProvider: MeterProvider;
  loggerProvider: LoggerProvider;
}

// Stashed on globalThis rather than in a module-level `let`.
//
// instrumentation.ts and an API route are separate entry points, and Next.js
// bundles them into separate chunks. A module-level variable is per-chunk, so
// the flush would read `undefined` while setup had genuinely run - telemetry
// that initialises, buffers, and is never sent, with nothing reporting a
// problem. `globalThis` is per-*process*, which is the scope the providers
// actually have. It is also how @opentelemetry/api registers its own globals,
// so this is the same trick rather than a new one.
const PROVIDERS = Symbol.for('bigshop.telemetry.providers');

type Global = typeof globalThis & { [PROVIDERS]?: Providers };

export function providers(): Providers | undefined {
  return (globalThis as Global)[PROVIDERS];
}

// Installs global tracer, meter and logger providers.
//
// Never throws. A failure here means "telemetry is not running", never "the
// request should fail" - so every step is best-effort and the whole thing is
// wrapped. Called once per runtime instance from instrumentation.ts.
export function setupTelemetry(): void {
  if (!enabled() || providers()) return;

  try {
    // Replaces the SDK's default handler, which writes every export failure to
    // the console. A collector that is down would otherwise turn into a log
    // flood in Netlify's function logs arriving exactly when something else is
    // already wrong. Dropping telemetry silently is the documented intent
    // (ADR-0007). Same reasoning, same effect, as otel.SetErrorHandler on the
    // Go side.
    setGlobalErrorHandler(() => {});

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: version(),
      // Written out rather than imported: both moved to the "incubating" entry
      // point of @opentelemetry/semantic-conventions, whose exported constant
      // names are explicitly unstable across minor versions. The attribute keys
      // themselves are stable, and they have to match the Go side's exactly or
      // the two runtimes do not appear in the same filter.
      'service.namespace': NAMESPACE,
      'deployment.environment.name': environment(),
    });

    const tracerProvider = new NodeTracerProvider({
      resource,
      // 100% sampling, per the spec: head sampling would discard exactly the
      // rare failure being investigated, and five LLM-backed routes do not
      // generate the volume that would justify it.
      sampler: new AlwaysOnSampler(),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ timeoutMillis: EXPORT_TIMEOUT_MS })
        ),
      ],
    });
    // register() rather than trace.setGlobalTracerProvider(): it also installs
    // the context manager and the W3C propagator, and the propagator is what
    // makes the traceparent injected in lib/dave/tools.ts carry this span.
    tracerProvider.register();

    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            timeoutMillis: EXPORT_TIMEOUT_MS,
            // **Delta, explicitly, and deliberately not the Go side's
            // cumulative** - ADR-0008 §2. Cumulative is the Prometheus default
            // and is designed for a long-lived process; a Lambda dies
            // constantly, so cumulative counters would reset endlessly and every
            // container would churn a fresh set of series.
            temporalityPreference: AggregationTemporalityPreference.DELTA,
          }),
          // The periodic reader never fires in a frozen process, so this
          // interval is not what exports metrics - flushTelemetry() is. It is
          // set high rather than left at the 60s default only so a warm
          // container does not wake up to do work that the next flush would do
          // anyway.
          exportIntervalMillis: 600_000,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    const loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ timeoutMillis: EXPORT_TIMEOUT_MS }),
        }),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    (globalThis as Global)[PROVIDERS] = {
      tracerProvider,
      meterProvider,
      loggerProvider,
    };
  } catch {
    // Swallowed on purpose. Whatever went wrong, the application still has a
    // request to serve, and the no-op API that @opentelemetry/api falls back to
    // means every call site keeps working with nothing behind it.
  }
}

// The tracer every span in this runtime is created from.
export function tracer() {
  return trace.getTracer(INSTRUMENTATION_SCOPE);
}

// version is the deployed revision, for telling "is this still happening after
// the fix?" from "this is the build before it". COMMIT_REF is Netlify's own
// name for the deployed sha, so production needs no extra configuration;
// SERVICE_VERSION is checked first to match the Go side, whose Fly deploy sets
// exactly that.
function version(): string {
  return process.env.SERVICE_VERSION || process.env.COMMIT_REF || 'dev';
}

// environment keeps production traffic distinguishable from a laptop's in a
// single-stack backend where both land in the same Tempo. CONTEXT is Netlify's,
// and is 'production' on the production deploy and 'deploy-preview' or
// 'branch-deploy' otherwise - which is more useful here than folding all three
// into one label.
function environment(): string {
  return process.env.DEPLOY_ENV || process.env.CONTEXT || 'development';
}
