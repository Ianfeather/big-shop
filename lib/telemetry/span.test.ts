import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordError, recordWarning, safeError, safeErrorMessage } from './span';

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

// The message V8 actually produces. Written out rather than described, because
// the whole point is that it quotes the input - and if a future V8 stops doing
// that, this test failing is the signal that the scrubbing can be reconsidered.
function jsonParseError(): unknown {
  try {
    // V8 quotes a short window of the input around the point it gave up, so the
    // recipe name has to sit next to the break for this to demonstrate anything.
    // That is not a contrivance: an extraction fails where the model's output
    // went wrong, which is in among the content, not politely at the end.
    JSON.parse('{"name": Sunday Roast Potatoes}');
    return new Error('unreachable');
  } catch (e) {
    return e;
  }
}

// What V8 actually puts in the message for the input above - a truncated recipe
// name. Asserted as a literal so that a future V8 which stops quoting the input
// fails this test loudly, rather than leaving the scrubbing in place forever
// against a risk that has gone away.
const LEAKED = 'Sunday Roa';

describe('safeError', () => {
  it('withholds a JSON parse message, which quotes the content being parsed', () => {
    const raw = jsonParseError();

    // Guard the premise: if this stops being true the scrubbing is pointless.
    expect((raw as Error).message).toContain(LEAKED);

    const safe = safeError(raw);
    expect(safe.message).not.toContain(LEAKED);
    expect(safe.message).toContain('ADR-0008');
  });

  it('leaves an ordinary error alone', () => {
    const safe = safeError(new Error('API request failed: 503'));
    expect(safe.message).toBe('API request failed: 503');
  });

  it('narrows a non-Error throw', () => {
    expect(safeErrorMessage('just a string')).toBe('just a string');
  });
});

describe('recordError', () => {
  it('does not put parsed content on the span', () => {
    // ADR-0008 §1 states the cost of this explicitly: when an extraction fails
    // because the model returned unparseable JSON, the response body is the
    // evidence, and it will not be in the trace.
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('extract');
    context.with(trace.setSpan(context.active(), span), () => recordError(jsonParseError()));
    span.end();

    const [finished] = exporter.getFinishedSpans();
    const exception = finished.events.find((e) => e.name === 'exception');
    expect(String(exception?.attributes?.['exception.message'])).not.toContain(LEAKED);
    expect(finished.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('recordWarning', () => {
  it('scrubs the error it attaches too', () => {
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('enrich');
    context.with(trace.setSpan(context.active(), span), () =>
      recordWarning('catalog enrichment failed', jsonParseError())
    );
    span.end();

    const [finished] = exporter.getFinishedSpans();
    const warning = finished.events.find((e) => e.name === 'warning');
    expect(String(warning?.attributes?.error)).not.toContain(LEAKED);
  });

  it('is a no-op with no active span', () => {
    expect(() => recordWarning('nothing to attach to')).not.toThrow();
  });
});
