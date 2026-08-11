// One span per Dave tool call.
//
// A Dave turn is a loop: the model is asked, it answers with tool calls, the
// tools run, the model is asked again, up to five times. From the outside that
// is a single slow request; from the inside it is a handful of OpenAI calls and
// a handful of Go API calls, and "why did that take eleven seconds" is only
// answerable if they are separable. These spans are what separate them - and
// because each tool's HTTP request carries the traceparent injected under this
// span, the Go API's own server span and its `otelsql` query spans hang beneath
// the tool that caused them. One trace, both runtimes, every hop.

import { SpanStatusCode } from '@opentelemetry/api';
import { tracer } from './setup';

// Runs `fn` inside a span named after the tool, and returns whatever it returns.
//
// The span records that a tool ran, how long it took and whether it failed, and
// nothing about what was asked or returned. ADR-0008 §1 names Dave chat messages
// as content telemetry does not carry, and a tool's arguments are a paraphrase
// of the message that produced them - `{"query": "something for my
// mother-in-law's birthday"}` is the user's sentence with the grammar removed.
//
// All four tools catch their own errors and return `{ success: false }` rather
// than throwing - deliberately, because a failed tool call is fed back to the
// model so it can apologise or try something else, which is better for the
// person talking to Dave than a 500. That means the `catch` here would never
// fire, so the failure is read off the returned value instead. Without that,
// every tool call would look like it worked and this route's error rate would be
// flat by construction.
export async function toolSpan<T extends { success: boolean; error?: string }>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer().startActiveSpan(`dave.tool ${name}`, async (span) => {
    try {
      const result = await fn();
      if (!result.success) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error });
      }
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
