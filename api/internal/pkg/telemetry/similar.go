package telemetry

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Metrics for Similar Recipes (specs/recipe-search-similar-recipes.md).
//
// The first metrics this API records by hand; everything else comes from
// otelhttp. Instruments are taken from the global MeterProvider lazily, so
// under `go test` - where Setup never runs - they are the SDK's no-ops.
//
// None of these carry what was searched for or which Recipes came back, and
// account.id is on the span only: ADR-0008 §1 and §2.
type similarInstruments struct {
	outcome    metric.Int64Counter
	latency    metric.Float64Histogram
	candidates metric.Int64Histogram
	matches    metric.Int64Histogram
	tokens     metric.Int64Counter
}

var (
	similarOnce sync.Once
	similar     similarInstruments
)

func similarMetrics() similarInstruments {
	similarOnce.Do(func() {
		m := otel.Meter(LoggerName)
		// Errors are ignored for the same reason as everywhere in this
		// package: a failed instrument is a no-op one, and telemetry must
		// never affect the application.
		similar.outcome, _ = m.Int64Counter("bigshop.similar.outcome",
			metric.WithDescription("Similar Recipes requests by how they ended: results, empty, partial, disabled or error"))
		similar.latency, _ = m.Float64Histogram("bigshop.similar.jev.duration",
			metric.WithUnit("s"),
			metric.WithDescription("How long the Jev fan-out took, for requests that made one"))
		similar.candidates, _ = m.Int64Histogram("bigshop.similar.candidates",
			metric.WithDescription("Recipe names sent to Jev for one search, across all its chunks"))
		similar.matches, _ = m.Int64Histogram("bigshop.similar.matches",
			metric.WithDescription("Similar Recipes returned for one search"))
		// Same name and label shape as the web side's counter
		// (lib/telemetry/metrics.ts), so one panel covers every model.
		similar.tokens, _ = m.Int64Counter("bigshop.llm.tokens",
			metric.WithDescription("Tokens consumed by model calls"))
	})
	return similar
}

// RecordSimilarRecipes records one Similar Recipes request.
//
// jevDuration is zero when no call was made (disabled, or no candidates), and
// is then left off the histogram rather than recorded as an instant answer.
// model must be a name fixed in code, never one read from a response: it is a
// metric label, and a value that could arrive from outside is unbounded.
func RecordSimilarRecipes(ctx context.Context, outcome string, candidates, matches int, jevDuration time.Duration, model string, inputTokens, outputTokens int64) {
	m := similarMetrics()
	m.outcome.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", outcome)))
	if jevDuration <= 0 {
		return
	}
	outcomeAttr := metric.WithAttributes(attribute.String("outcome", outcome))
	m.latency.Record(ctx, jevDuration.Seconds(), outcomeAttr)
	m.candidates.Record(ctx, int64(candidates))
	m.matches.Record(ctx, int64(matches))
	if inputTokens > 0 {
		m.tokens.Add(ctx, inputTokens, metric.WithAttributes(attribute.String("model", model), attribute.String("direction", "input")))
	}
	if outputTokens > 0 {
		m.tokens.Add(ctx, outputTokens, metric.WithAttributes(attribute.String("model", model), attribute.String("direction", "output")))
	}
}
