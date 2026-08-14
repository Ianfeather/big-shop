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
import { recordRequestDuration } from './metrics';
import { tracer } from './setup';
import { safeError } from './span';

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
    // performance.now(), not Date.now(): a monotonic clock cannot be dragged
    // backwards by an NTP correction mid-request, which is how a latency
    // histogram acquires negative observations that no amount of staring at the
    // dashboard explains.
    const startedAt = performance.now();

    const span = tracer().startSpan(`${req.method} ${route}`, {
      attributes: {
        'http.request.method': req.method ?? 'UNKNOWN',
        'http.route': route,
      },
    });

    // "Put `x-nf-request-id` on the server span for any request arriving via the
    // Netlify proxy. It is the only handle that correlates a Big Shop trace with
    // Netlify's own request logs, and it costs one attribute." - specs/
    // observability.md. The Go API's middleware does this for requests reaching
    // it through the proxy; these five routes *are* Netlify functions, so it
    // matters here at least as much.
    //
    // The attribute key is `netlify.request_id`, spelled to match
    // telemetry/http.go:106 exactly. A different spelling on each side would
    // still be two perfectly good attributes, and would still make the one query
    // this exists for - find both runtimes' work for one Netlify request -
    // impossible to write as one query.
    //
    // Absent locally, where there is no Netlify in front. `headers` itself is
    // optional-chained for the same reason `res.statusCode` is guarded below:
    // the route tests hand-roll a NextApiRequest out of the two or three fields
    // the handler reads, and a wrapper that assumes the whole interface turns
    // every one of those into a TypeError.
    const netlifyRequestId = req.headers?.['x-nf-request-id'];
    if (typeof netlifyRequestId === 'string') {
      span.setAttribute('netlify.request_id', netlifyRequestId);
    }

    try {
      // The handler runs inside the span's context so that anything it calls -
      // span.ts's recordAccount, the tool spans in lib/dave/tools.ts, the
      // traceparent injected into an outbound fetch - finds this span as its
      // parent without being handed it explicitly.
      return await context.with(trace.setSpan(context.active(), span), () =>
        handler(req, res)
      );
    } catch (error) {
      span.recordException(safeError(error));
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

      // Recorded before the flush, which is the whole reason it is here rather
      // than anywhere else: metrics only leave a Lambda on ForceFlush, so a
      // measurement taken afterwards would sit in the reader until the *next*
      // request on the same container, and be lost with the container if there
      // isn't one. Divided by 1000 because the histogram is in seconds, per the
      // OTel convention the Go side's otelhttp metric also follows.
      recordRequestDuration(
        route,
        typeof res.statusCode === 'number' ? res.statusCode : 0,
        (performance.now() - startedAt) / 1000
      );

      span.end();
      await flushTelemetry();
    }
  };
}
