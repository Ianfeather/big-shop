// The synchronous, bounded flush that ADR-0007 confines to this side of the
// design - and the circuit breaker that stops it costing anything once the
// endpoint is known to be down.
//
// **Why a flush exists here at all.** A Lambda's execution environment freezes
// the instant the handler returns. There is no "after the response": a batch
// processor's timer never fires, and anything still buffered is lost. The Go
// API on Fly has the opposite problem - it is a long-lived process, so its batch
// export is entirely off the request path and it flushes only at shutdown. Same
// SDK, opposite configuration, on purpose (ADR-0007).
//
// Metrics make this non-optional rather than merely better: a PeriodicReader in
// a frozen process never exports at all, so without this call the two counters
// in metrics.ts would never leave the function.

import { providers, EXPORT_TIMEOUT_MS } from './setup';

// The bound on the whole flush - all three providers, in parallel.
//
// A backstop rather than the primary limit. Each exporter is already bounded by
// EXPORT_TIMEOUT_MS and the three run concurrently (see below), so a healthy
// worst case is about one of those plus scheduling; this only has to catch a
// hang the exporters' own timeouts somehow do not. Three times one exporter's
// timeout is therefore deliberately generous - and still 750ms, nowhere near
// the seconds-long stall ADR-0007 is written to prevent.
const FLUSH_TIMEOUT_MS = 3 * EXPORT_TIMEOUT_MS;

// How many consecutive failures before this container stops trying.
//
// Three rather than one because a single failure is more likely to be a stale
// keep-alive than a dead endpoint, and re-probing costs one bounded timeout.
const BREAKER_THRESHOLD = 3;

// Circuit breaker state, per container.
//
// Netlify containers persist across invocations, so a container that has learned
// the endpoint is unreachable stops paying EXPORT_TIMEOUT_MS on every subsequent
// request for the rest of its life. A new container starts at zero and
// re-probes, which is what makes this self-heal with no cooldown timer, no
// half-open state and no clock - the platform's own container churn is the
// reset mechanism. ADR-0007 chose it for exactly that reason.
//
// On globalThis for the same reason the providers are: Next.js bundles each
// entry point separately, so a module-level counter would be per-chunk and the
// breaker would silently never trip.
const BREAKER = Symbol.for('bigshop.telemetry.breaker');

type Global = typeof globalThis & { [BREAKER]?: { consecutiveFailures: number } };

function breaker() {
  const g = globalThis as Global;
  g[BREAKER] ??= { consecutiveFailures: 0 };
  return g[BREAKER];
}

// Exported for tests. Resets the breaker to its cold-container state.
export function resetCircuitBreaker(): void {
  breaker().consecutiveFailures = 0;
}

// Exported for tests. True once this container has given up flushing.
export function circuitOpen(): boolean {
  return breaker().consecutiveFailures >= BREAKER_THRESHOLD;
}

// Forces the three providers to export whatever they are holding, and resolves
// when they have - or when the bound expires, whichever comes first.
//
// **Never rejects, and never throws.** Every caller is a request handler that
// has already done its real work; a telemetry failure must not become the
// user's problem. The only observable effect of the endpoint being down is that
// this returns a little sooner and the data is gone.
export async function flushTelemetry(): Promise<void> {
  const p = providers();
  if (!p || circuitOpen()) return;

  // **Concurrently, not sequentially.** ADR-0007 calls this the single biggest
  // avoidable cost in the design, and the arithmetic is why: sequential is three
  // round trips to the same endpoint for no benefit whatsoever, on a code path
  // that runs before every response. Promise.allSettled rather than Promise.all
  // so one provider failing does not abandon the other two mid-flight.
  //
  // **Constructed inside the `try`, which is load-bearing rather than tidy.**
  // `Promise.allSettled` converts a *rejected* promise into a settled result,
  // but it cannot do anything about a provider that throws *synchronously* -
  // that throw happens while the argument array is still being evaluated, before
  // allSettled is called at all. Built one line higher, outside the try, it
  // would escape this function; and since api-route.ts awaits this in a
  // `finally`, a rejection there replaces the handler's outcome and turns a
  // perfectly good 200 into a 500. Telemetry taking the application down is the
  // exact failure ADR-0007 exists to prevent.
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const flushes = Promise.allSettled([
      p.tracerProvider.forceFlush(),
      p.meterProvider.forceFlush(),
      p.loggerProvider.forceFlush(),
    ]);

    // The bound. forceFlush() takes no timeout argument in this SDK, so the
    // equivalent of Go's `context.WithTimeout` - which ADR-0007 requires on
    // every flush, and requires never to be the unbounded one - has to be built
    // from a race. The timer is unref'd so a pending flush can never be the
    // reason a process stays alive.
    const bound = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), FLUSH_TIMEOUT_MS);
      timer.unref?.();
    });

    const outcome = await Promise.race([flushes, bound]);

    if (outcome === 'timeout') {
      recordFailure();
      // The flush promise is left running rather than awaited. It is already
      // bounded by the exporter's own timeout, and the container is about to
      // freeze regardless; blocking on it is the stall this bound exists to
      // prevent.
      return;
    }

    // A settled-but-rejected flush counts as a failure too. Without this the
    // breaker would only ever trip on timeouts, and an endpoint returning a
    // fast 401 - a wrong credential, the most likely misconfiguration here -
    // fails instantly rather than slowly, so it would never be counted.
    if (outcome.some((r) => r.status === 'rejected')) {
      recordFailure();
      return;
    }

    breaker().consecutiveFailures = 0;
  } catch {
    // Unreachable via allSettled/race, but a flush must not be able to throw
    // into a handler under any circumstances.
    recordFailure();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function recordFailure(): void {
  breaker().consecutiveFailures += 1;
}
