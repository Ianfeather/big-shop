// Attaching facts to whatever span is currently active.
//
// Separate from api-route.ts because both a route handler and a Dave tool call
// need these, and only the former has a NextApiResponse to talk about. Each one
// is a no-op when there is no active span - telemetry disabled, or a unit test
// with no provider registered - so no call site needs to guard.

import { SpanStatusCode, trace } from '@opentelemetry/api';

// Turns anything thrown into an Error safe to put on a span.
//
// Two jobs, and the second is the one that matters. The first is the dull
// `unknown` -> `Error` narrowing every call site would otherwise repeat.
//
// The second: **`JSON.parse` puts a slice of its input into its error message**,
// and on these paths that input is model output or a Go API response body -
// which is to say recipe names, ingredient text, someone's photographed page.
// ADR-0008 §1 says telemetry does not carry those, and states the cost
// explicitly: "when an LLM extraction fails because GPT returned unparseable
// JSON, the response body *is* the evidence, and it will not be in the trace."
// A SyntaxError reaching `recordException` unedited would quietly reverse that
// decision, on the exact failure it was written about.
//
// Scrubbed here, at the boundary where an error becomes telemetry, rather than
// at the handful of `JSON.parse` call sites - a rule that has to be remembered
// at every future parse is a rule that will be broken at one of them. The
// replacement keeps the type name, which is the part worth having: "an
// extraction came back unparseable" is the finding, and the bytes are
// reproducible locally.
export function safeError(error: unknown): Error {
  if (error instanceof SyntaxError) {
    return new Error(
      'SyntaxError parsing a response body (message withheld: it quotes the ' +
        'content being parsed - ADR-0008 §1)'
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

// The same scrubbing, for the call sites that want a string rather than an
// Error - a span status message, a log attribute, or a tool result that is fed
// back to the model and returned to the browser.
export function safeErrorMessage(error: unknown): string {
  return safeError(error).message;
}

// Attaches the caller's Account to the current span.
//
// Called by the routes that authenticate, after they have. `account.id` is the
// handle that makes "show me everything that happened for account 1 around
// 14:20" work, and ADR-0008 §1 allows it on a span precisely because it is
// pseudonymous - it is an integer, and resolving it to a person needs the
// database. It must never reach a *metric*, which is §2 and is the single most
// likely thing here to be "corrected" by someone noticing the asymmetry.
//
// There is no `user.sub` counterpart, unlike the Go API's spans. These routes
// never see the Auth0 subject: lib/authenticate.ts verifies a token by asking
// the Go API which Account it resolves to, and the answer is an id and nothing
// else. Adding one would mean decoding a JWT this runtime deliberately does not
// validate.
export function recordAccount(accountId: number): void {
  trace.getActiveSpan()?.setAttribute('account.id', accountId);
}

// Records the cause of a failure the caller is about to answer with a 5xx, or
// with a `{ success: false }` tool result.
//
// Needed as an explicit call because the handlers and tools in this codebase
// catch their own errors and return a message rather than letting them
// propagate - so a wrapper sees only a status code, and a status code is not a
// cause. This is exactly the defect Phase 3's review caught on the Go side: a
// span that records *that* something failed and loses *what*, at the moment the
// span became the only copy.
export function recordError(error: unknown): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.recordException(safeError(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

// Records something that went wrong but that the caller is choosing to carry on
// through, as an event on the current span.
//
// The Go side arrived at the same shape in Phase 3 (correction 8): for a
// best-effort failure whose caller deliberately ignores it there is nothing to
// wrap and return, and a log line would be an uncorrelated line in Netlify's
// function log rather than something attached to the request that caused it.
export function recordWarning(message: string, error?: unknown): void {
  trace.getActiveSpan()?.addEvent('warning', {
    message,
    ...(error !== undefined ? { error: safeErrorMessage(error) } : {}),
  });
}
