// Attaching facts to whatever span is currently active.
//
// Separate from api-route.ts because both a route handler and a Dave tool call
// need these, and only the former has a NextApiResponse to talk about. Each one
// is a no-op when there is no active span - telemetry disabled, or a unit test
// with no provider registered - so no call site needs to guard.

import { SpanStatusCode, trace } from '@opentelemetry/api';

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
  span.recordException(error instanceof Error ? error : new Error(String(error)));
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
    ...(error !== undefined
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
  });
}
