// One server span per Next.js API route request, and the flush that gets it out
// of the container before it freezes.
//
// This is the Netlify-side equivalent of the Go API's telemetry middleware
// (netlify-functions/recipes/internal/pkg/telemetry/http.go), and it makes the
// same two judgement calls for the same two reasons:
//
//   - **`http.route` is a hard-coded template, never the request path.** On the
//     Go side that mattered because `/recipe/{id}` also accepts a slug, so a
//     recipe name was reaching the span name and an unbounded metric label -
//     content by ADR-0008 §1 and cardinality by §2, from a value a stranger
//     controls. Nothing here takes a path parameter today, but the property
//     worth keeping is that the label set cannot be widened from outside, and a
//     literal passed at the call site cannot drift into one that can.
//   - **`span.setStatus(ERROR)` fires on 5xx, not on every non-2xx**, while
//     `recordException` fires on anything thrown. A 400 for a missing `url`, or
//     the 422 for a page with no ingredients on it, is this route working. If
//     those turned spans red then "show me the errors" would mean "show me the
//     traffic", which is the state Phase 3's correction 7 exists to avoid.

import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { flushTelemetry } from './flush';
import { tracer } from './setup';

// The route templates this runtime serves. A closed set, written out so that
// `http.route` is provably bounded rather than bounded by inspection.
export type Route =
  | '/api/parse-recipe-url'
  | '/api/parse-recipe-text'
  | '/api/parse-method-url'
  | '/api/recipe-image'
  | '/api/dave/chat';

// Wraps a Next.js API route handler in a span, and flushes before returning.
//
// The flush is in a `finally`, so it happens on the thrown path as well as the
// returned one - the thrown path being precisely where the span is worth
// having. It is awaited, which is the whole point: returning without awaiting
// it would let the container freeze with the span still in the batch processor,
// which is the failure ADR-0007's Netlify half is written to prevent.
export function withTelemetry(route: Route, handler: NextApiHandler): NextApiHandler {
  return async function instrumented(req: NextApiRequest, res: NextApiResponse) {
    const span = tracer().startSpan(`${req.method} ${route}`, {
      attributes: {
        'http.request.method': req.method ?? 'UNKNOWN',
        'http.route': route,
      },
    });

    try {
      // The handler runs inside the span's context so that anything it calls -
      // span.ts's recordAccount, the tool spans in lib/dave/tools.ts, the
      // traceparent injected into an outbound fetch - finds this span as its
      // parent without being handed it explicitly.
      return await context.with(trace.setSpan(context.active(), span), () =>
        handler(req, res)
      );
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      // Guarded because `res.statusCode` is a real Node property on a real
      // response and absent on the hand-rolled mock the route tests pass in.
      // Recording `undefined` as an attribute value is a type error the OTel
      // API answers with a diag warning rather than a throw, so the cost of
      // getting this wrong is a puzzling log line in an otherwise passing test
      // suite.
      if (typeof res.statusCode === 'number') {
        span.setAttribute('http.response.status_code', res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
      }
      span.end();
      await flushTelemetry();
    }
  };
}
