import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-node';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTelemetry } from './api-route';
import { recordAccount, recordError } from './span';

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  // register() rather than trace.setGlobalTracerProvider(): it also installs
  // the AsyncLocalStorage context manager, which is what makes context.with()
  // in withTelemetry actually propagate the active span to the helpers called
  // inside the handler. Without it every one of these cases would pass on the
  // span attributes and fail on the helpers, for reasons unrelated to them.
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

function req(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return { method: 'POST', ...overrides } as NextApiRequest;
}

function res(statusCode = 200): NextApiResponse {
  return { statusCode } as NextApiResponse;
}

function finished(): ReadableSpan {
  const spans = exporter.getFinishedSpans();
  return spans[spans.length - 1];
}

describe('withTelemetry', () => {
  it('names the span for the method and the route template', async () => {
    await withTelemetry('/api/dave/chat', async () => {})(req(), res());

    expect(finished().name).toBe('POST /api/dave/chat');
    expect(finished().attributes['http.route']).toBe('/api/dave/chat');
  });

  // The Go side's Phase 3 review found a recipe name reaching http.route,
  // because the route was derived from the request path. Here the template is a
  // literal passed at the call site, so the equivalent mistake is not
  // expressible - this asserts that the request cannot influence it.
  it('takes http.route from the template, never from the request', async () => {
    await withTelemetry('/api/recipe-image', async () => {})(
      req({ url: '/api/recipe-image?jobId=a-user-controlled-value' }),
      res()
    );

    expect(finished().attributes['http.route']).toBe('/api/recipe-image');
    expect(finished().name).not.toContain('a-user-controlled-value');
  });

  // The spec calls this out by name: it is the only handle that correlates a Big
  // Shop trace with Netlify's own request logs. The key must match the Go
  // middleware's spelling exactly, or the one query it exists for cannot be
  // written.
  it('carries the Netlify request id when there is one', async () => {
    await withTelemetry('/api/dave/chat', async () => {})(
      req({ headers: { 'x-nf-request-id': '01JABCD-ef01' } }),
      res()
    );

    expect(finished().attributes['netlify.request_id']).toBe('01JABCD-ef01');
  });

  it('sets no Netlify attribute when the request did not come through Netlify', async () => {
    await withTelemetry('/api/dave/chat', async () => {})(req({ headers: {} }), res());

    expect(finished().attributes).not.toHaveProperty('netlify.request_id');
  });

  it('survives a request mock with no headers at all', async () => {
    // Every existing route test under pages/api builds its NextApiRequest from
    // the two or three fields the handler reads. A wrapper that assumes the full
    // interface breaks all of them at once.
    await expect(
      withTelemetry('/api/dave/chat', async () => {})(req(), res())
    ).resolves.toBeUndefined();
  });

  it('records the response status', async () => {
    await withTelemetry('/api/parse-recipe-url', async () => {})(req(), res(422));

    expect(finished().attributes['http.response.status_code']).toBe(422);
  });

  // "Show me the errors" must not mean "show me the traffic" - Phase 3's
  // correction 7, applied on this side.
  it('leaves a 4xx unset rather than marking the span failed', async () => {
    await withTelemetry('/api/parse-recipe-url', async () => {})(req(), res(422));

    expect(finished().status.code).toBe(SpanStatusCode.UNSET);
  });

  it('marks a 5xx failed', async () => {
    await withTelemetry('/api/parse-recipe-url', async () => {})(req(), res(500));

    expect(finished().status.code).toBe(SpanStatusCode.ERROR);
  });

  it('records a thrown error and lets it propagate', async () => {
    const boom = new Error('boom');
    const handler = withTelemetry('/api/dave/chat', async () => {
      throw boom;
    });

    await expect(handler(req(), res(500))).rejects.toThrow('boom');

    expect(finished().status.code).toBe(SpanStatusCode.ERROR);
    expect(finished().events.map((e) => e.name)).toContain('exception');
  });

  it('ends the span even when the response mock has no statusCode', async () => {
    // The route tests hand-roll a NextApiResponse with only status() and
    // json() on it. Reading an absent statusCode must not produce an attribute
    // or a warning.
    await withTelemetry('/api/parse-recipe-text', async () => {})(
      req(),
      {} as NextApiResponse
    );

    expect(finished().attributes).not.toHaveProperty('http.response.status_code');
  });
});

describe('span helpers, inside a request', () => {
  it('attaches the account to the request span', async () => {
    await withTelemetry('/api/parse-method-url', async () => {
      recordAccount(7);
    })(req(), res());

    expect(finished().attributes['account.id']).toBe(7);
  });

  it('records the cause on a handler that answers its own 500', async () => {
    // The routes catch and answer rather than throwing, so without recordError
    // the span would say a request failed and lose what failed - which is the
    // defect Phase 3's review caught on the Go side, at the point the span had
    // become the only copy.
    await withTelemetry('/api/parse-recipe-url', async () => {
      recordError(new Error('network down'));
    })(req(), res(500));

    const exception = finished().events.find((e) => e.name === 'exception');
    expect(exception?.attributes?.['exception.message']).toBe('network down');
  });
});
