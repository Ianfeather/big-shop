// Package telemetry wires the OpenTelemetry SDK up for the Go API: traces,
// metrics and logs, all three exported over OTLP/HTTP to whatever collector
// OTEL_EXPORTER_OTLP_ENDPOINT names.
//
// Decisions live in docs/adr/0007-observability-otel-grafana-cloud.md; what the
// telemetry deliberately does not carry lives in docs/adr/0008. The one rule
// that governs every line of this file: **telemetry must never affect the
// application.** Nothing here returns a fatal condition, nothing here logs on an
// export failure, and Setup on a machine with no collector is a no-op rather
// than a problem.
package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"time"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// ServiceName is the OTel service.name for this runtime. ADR-0007's tenancy
// model is one Grafana stack shared across projects, separated by
// service.namespace, with service.name naming the runtime within a project -
// hence bigshop-api here, bigshop-web and bigshop-browser later.
const ServiceName = "bigshop-api"

// Namespace separates this project from any other sharing the free-tier stack.
// It is the attribute every dashboard and every "is this us?" query filters on.
const Namespace = "bigshop"

// LoggerName labels log records emitted through the otelslog bridge.
const LoggerName = "recipes"

// ShutdownTimeout bounds the flush of all three providers at process exit. Long
// enough for a batch to drain over a local network hop, short enough that a
// wedged collector cannot stop the process from dying.
const ShutdownTimeout = 5 * time.Second

// Enabled reports whether telemetry will actually be set up.
//
// The presence of OTEL_EXPORTER_OTLP_ENDPOINT is the switch, rather than a
// dedicated flag, because it is the one thing that must be true for export to
// work at all - so there is no way to be "enabled" and misconfigured. `go test`
// and the Lambda rollback path set nothing and therefore get no SDK, no
// background goroutines and no connection attempts.
func Enabled() bool {
	return os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != ""
}

// Setup installs global tracer, meter and logger providers and returns a
// shutdown function that flushes all three.
//
// It never returns a fatal condition. An error here means "telemetry is not
// running", never "the process should stop" - main.go's DB ping is allowed to
// be fatal because without a database there is nothing to serve; without a
// collector there is simply less to see. The returned shutdown is always
// non-nil and always safe to call, including when setup failed part-way.
func Setup(ctx context.Context) (func(context.Context) error, error) {
	if !Enabled() {
		return func(context.Context) error { return nil }, nil
	}

	// Replaces the SDK's default handler, which writes every export failure to
	// stderr. A collector that is down would otherwise turn into a log flood
	// arriving exactly when something else is already wrong. Dropping telemetry
	// silently is the documented intent (ADR-0007).
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) {}))

	res, err := newResource(ctx)
	if err != nil {
		// A resource that could not be fully detected is still usable - it just
		// carries fewer attributes - so this is not a reason to give up.
		res = resource.NewSchemaless(identityAttributes()...)
	}

	var shutdowns []func(context.Context) error
	// Composed up front so a failure part-way through still returns something
	// that tears down whatever did get created.
	shutdown := func(ctx context.Context) error {
		var errs []error
		for _, fn := range shutdowns {
			if err := fn(ctx); err != nil {
				errs = append(errs, err)
			}
		}
		return errors.Join(errs...)
	}

	// Trace. The batch processor is what keeps export off the request path
	// entirely - the reason ADR-0007 can be relaxed about the Frankfurt-to-AWS
	// hop. No endpoint is passed: the SDK reads OTEL_EXPORTER_OTLP_ENDPOINT
	// itself, so the collector address is configuration rather than code.
	traceExporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return shutdown, err
	}
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExporter),
		// 100% sampling, per the spec: head sampling would discard exactly the
		// rare failure being investigated, and this volume does not need it.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	shutdowns = append(shutdowns, tracerProvider.Shutdown)
	otel.SetTracerProvider(tracerProvider)

	// W3C traceparent in and out. Inbound matters from Session 5, when a Dave
	// turn starts in a Netlify function and continues here; installing it now
	// costs nothing and means the Go side is already the cooperative end.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	// Metrics. Cumulative temporality - the SDK default, and deliberately NOT
	// the delta the Netlify functions will use: this is a long-lived process,
	// which is the case cumulative is designed for. ADR-0008 §2 explains why the
	// two runtimes differ here on purpose.
	metricExporter, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return shutdown, err
	}
	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),
	)
	shutdowns = append(shutdowns, meterProvider.Shutdown)
	otel.SetMeterProvider(meterProvider)

	// Logs. Routed through the otelslog bridge (see Logger) so that a log line
	// written with a request's context carries that request's trace_id, which is
	// what makes "show me the logs for this trace" work.
	logExporter, err := otlploghttp.New(ctx)
	if err != nil {
		return shutdown, err
	}
	loggerProvider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)),
	)
	shutdowns = append(shutdowns, loggerProvider.Shutdown)
	global.SetLoggerProvider(loggerProvider)

	return shutdown, nil
}

// Logger returns an slog.Logger writing through the OTel log bridge.
//
// Callers must use the *Context variants (slog.InfoContext, not slog.Info): the
// trace_id is read from the context, and a line logged without one is
// deliverable but uncorrelated, which is most of the value gone.
//
// Built once on first *call* rather than eagerly, and the distinction matters:
// otelslog.NewLogger resolves the global LoggerProvider at construction, so a
// plain package-level var would be initialised during package init - before
// Setup has installed the real provider - and would capture the no-op one for
// the life of the process. Every log line would then vanish, with nothing
// anywhere reporting a problem. Lazily is the only safe timing, and OnceValue
// means the cost is paid once rather than per request.
var Logger = sync.OnceValue(func() *slog.Logger {
	return otelslog.NewLogger(LoggerName)
})

// identityAttributes are the attributes that make a signal attributable to this
// service in a stack shared with other projects. Split out from newResource so
// the fallback path in Setup can still carry them when detection fails.
func identityAttributes() []attribute.KeyValue {
	return []attribute.KeyValue{
		semconv.ServiceNamespace(Namespace),
		semconv.ServiceName(ServiceName),
		semconv.ServiceVersion(version()),
		semconv.DeploymentEnvironmentName(environment()),
	}
}

// newResource describes *this* process to the backend.
func newResource(ctx context.Context) (*resource.Resource, error) {
	return resource.New(ctx,
		resource.WithHost(),
		resource.WithProcessRuntimeDescription(),
		resource.WithAttributes(identityAttributes()...),
	)
}

// version is the deployed revision, for telling "is this still happening after
// the fix?" from "this is the build before it". Set from the git sha at deploy
// time; "dev" locally, where the answer is always "whatever is in the tree".
func version() string {
	if v := os.Getenv("SERVICE_VERSION"); v != "" {
		return v
	}
	return "dev"
}

// environment keeps production traffic distinguishable from a laptop's in a
// single-stack backend where both land in the same Tempo.
func environment() string {
	if e := os.Getenv("DEPLOY_ENV"); e != "" {
		return e
	}
	return "development"
}
