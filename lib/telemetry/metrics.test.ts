import { metrics as metricsApi } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  recordImportOutcome,
  recordRequestDuration,
  recordTokenUsage,
  resetInstruments,
} from './metrics';

let reader: PeriodicExportingMetricReader;
let provider: MeterProvider;

beforeEach(() => {
  reader = new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.DELTA),
    // Long enough that nothing exports on its own - collect() is called
    // explicitly below.
    exportIntervalMillis: 600_000,
  });
  provider = new MeterProvider({ readers: [reader] });
  metricsApi.setGlobalMeterProvider(provider);
  // The instruments are cached on first use and bind to whichever provider was
  // registered then, so each case needs them rebuilt against its own.
  resetInstruments();
});

afterEach(async () => {
  await provider.shutdown();
  metricsApi.disable();
});

async function pointsFor(name: string): Promise<DataPoint<number>[]> {
  const collected = await reader.collect();
  const metric = collected.resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === name);
  return (metric?.dataPoints ?? []) as DataPoint<number>[];
}

describe('recordImportOutcome', () => {
  it('counts an import under its Source and result', async () => {
    recordImportOutcome('url', 'success');
    recordImportOutcome('url', 'success');
    recordImportOutcome('photo', 'error');

    const points = await pointsFor('bigshop.import.outcome');

    expect(points).toHaveLength(2);
    expect(points).toContainEqual(
      expect.objectContaining({ attributes: { source: 'url', result: 'success' }, value: 2 })
    );
    expect(points).toContainEqual(
      expect.objectContaining({ attributes: { source: 'photo', result: 'error' }, value: 1 })
    );
  });

  // ADR-0008 §2 exists because this looks like an inconsistency and is not:
  // account.id is on every span this runtime emits and must never be on a
  // metric, where it would multiply every series by the account count against a
  // 10,000 ceiling. The rule is worth a test rather than a comment because the
  // way it gets broken is somebody adding it "for consistency".
  it('carries no unbounded label - in particular, no account.id', async () => {
    recordImportOutcome('url', 'success');

    const [point] = await pointsFor('bigshop.import.outcome');

    expect(Object.keys(point.attributes).sort()).toEqual(['result', 'source']);
  });
});

describe('recordTokenUsage', () => {
  it('reads the Responses API shape used by Recipe Import', async () => {
    recordTokenUsage('gpt-5.6-terra', { input_tokens: 1200, output_tokens: 340 });

    const points = await pointsFor('bigshop.llm.tokens');

    expect(points).toContainEqual(
      expect.objectContaining({
        attributes: { model: 'gpt-5.6-terra', direction: 'input' },
        value: 1200,
      })
    );
    expect(points).toContainEqual(
      expect.objectContaining({
        attributes: { model: 'gpt-5.6-terra', direction: 'output' },
        value: 340,
      })
    );
  });

  it('reads the Chat Completions shape used by Dave', async () => {
    recordTokenUsage('gpt-3.5-turbo', { prompt_tokens: 90, completion_tokens: 12 });

    const points = await pointsFor('bigshop.llm.tokens');

    expect(points.map((p) => p.value).sort((a, b) => a - b)).toEqual([12, 90]);
  });

  it('records nothing at all when usage is absent', async () => {
    // Absent usage is a streamed or errored call. Recording a zero would drag
    // any average computed over this counter towards zero, which is worse than
    // recording nothing.
    recordTokenUsage('gpt-3.5-turbo', undefined);
    recordTokenUsage('gpt-3.5-turbo', null);
    recordTokenUsage('gpt-3.5-turbo', {});

    expect(await pointsFor('bigshop.llm.tokens')).toHaveLength(0);
  });

  it('records the direction it does have when the other is missing', async () => {
    recordTokenUsage('gpt-3.5-turbo', { prompt_tokens: 90 });

    const points = await pointsFor('bigshop.llm.tokens');

    expect(points).toHaveLength(1);
    expect(points[0].attributes).toEqual({ model: 'gpt-3.5-turbo', direction: 'input' });
  });
});

describe('recordRequestDuration', () => {
  it('records in seconds, matching the Go API histogram it shares a dashboard with', async () => {
    // A histogram declared in seconds and fed milliseconds is wrong by a factor
    // of a thousand and looks entirely plausible on a graph, so the unit is
    // worth an assertion rather than a comment.
    recordRequestDuration('/api/dave/chat', 200, 1.5);

    const points = await pointsFor('bigshop.web.request.duration');

    expect(points).toHaveLength(1);
    const point = points[0] as unknown as { value: { sum: number; count: number } };
    expect(point.value.sum).toBeCloseTo(1.5);
    expect(point.value.count).toBe(1);
  });

  it('labels by route and status, and by nothing else', async () => {
    // ADR-0008 §2 again: this is the runtime whose spans carry account.id, and
    // the histogram is the most tempting place to add it "for consistency".
    recordRequestDuration('/api/parse-recipe-url', 422, 0.2);

    const [point] = await pointsFor('bigshop.web.request.duration');

    expect(point.attributes).toEqual({
      'http.route': '/api/parse-recipe-url',
      'http.response.status_code': 422,
    });
  });

  it('keeps failures separate from successes on the same route', async () => {
    // An endpoint that is slow only when it errors is a real shape, and one that
    // a histogram aggregated across statuses hides completely.
    recordRequestDuration('/api/dave/chat', 200, 0.1);
    recordRequestDuration('/api/dave/chat', 500, 9.0);

    const points = await pointsFor('bigshop.web.request.duration');

    expect(points).toHaveLength(2);
  });
});
