// The log bridge for this runtime - the third of ADR-0007's three signals.
//
// Without it, the LoggerProvider that setup.ts installs and flush.ts flushes
// would have nothing to carry, and "all three signals, correlated" would be true
// of the Go API and notional here.
//
// **Most things that went wrong should not come through here.** ADR-0008 §3's
// rule - the information belongs in the span - holds on this side too, and the
// routes follow it: a failure they answer with a 5xx goes to span.ts's
// recordError, and a best-effort failure they carry on through goes to
// recordWarning. What is left, and what this is for, is the handful of lines in
// lib/ that say something a span genuinely does not: that a *deployment* is
// misconfigured. "API_HOST_INTERNAL is unset" is not a fact about the request
// that tripped over it, and reading it as one - once per request, forever, until
// somebody sets the variable - is the wrong shape.
//
// It writes to the console as well as to Loki, deliberately. A misconfiguration
// message that only reaches a telemetry backend is invisible in exactly the case
// where the telemetry backend is the thing that is misconfigured.

import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import { LoggerName } from './setup';

// Emitted with no explicit context, so the SDK reads the active one - which is
// what puts the request's trace_id on the record and makes "show me the logs for
// this trace" work. A line written outside a request still delivers; it is
// simply uncorrelated, which is the honest representation of a process-level
// problem.
export function logError(message: string, error?: unknown): void {
  if (error !== undefined) {
    console.error(message, error);
  } else {
    console.error(message);
  }

  try {
    logs.getLogger(LoggerName).emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: message,
      attributes:
        error !== undefined
          ? { 'exception.message': error instanceof Error ? error.message : String(error) }
          : undefined,
    });
  } catch {
    // Telemetry must never affect the application (ADR-0007). The console.error
    // above has already happened, so nothing is lost that was not already
    // going to be lost.
  }
}
