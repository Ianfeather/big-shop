import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { circuitOpen, flushTelemetry, resetCircuitBreaker } from './flush';

// The providers are read from a Symbol.for key on globalThis rather than from a
// module-level variable, precisely so that they survive Next.js bundling each
// entry point separately. Symbol.for goes through the process-wide registry, so
// a test can reach the same slot the real setup writes to without production
// code needing a test-only seam.
const PROVIDERS = Symbol.for('bigshop.telemetry.providers');

type Flusher = { forceFlush: () => Promise<void> };

function installProviders(behaviour: () => Promise<void>) {
  const make = (): Flusher => ({ forceFlush: vi.fn(behaviour) });
  const providers = {
    tracerProvider: make(),
    meterProvider: make(),
    loggerProvider: make(),
  };
  (globalThis as Record<symbol, unknown>)[PROVIDERS] = providers;
  return providers;
}

beforeEach(() => {
  resetCircuitBreaker();
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[PROVIDERS];
  vi.useRealTimers();
});

describe('flushTelemetry', () => {
  it('flushes all three providers concurrently, not one after another', async () => {
    // ADR-0007 calls sequential flushing the single biggest avoidable cost in
    // the design. "Concurrently" is asserted by observing that all three are
    // in flight at once rather than by timing, which would be flaky.
    let inFlight = 0;
    let peak = 0;
    installProviders(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await flushTelemetry();

    expect(peak).toBe(3);
  });

  it('does nothing at all when no providers are installed', async () => {
    delete (globalThis as Record<symbol, unknown>)[PROVIDERS];
    await expect(flushTelemetry()).resolves.toBeUndefined();
  });

  // Regression. The three forceFlush() calls used to be evaluated one line
  // above the try block, so a provider that threw *synchronously* escaped -
  // and api-route.ts awaits this inside a `finally`, where a rejection replaces
  // the handler's outcome and turns a 200 into a 500. Promise.allSettled cannot
  // help: the throw happens while its argument array is still being built.
  //
  // Distinct from the async case below, which that arrangement did handle, and
  // which is why the original test passed while the bug was live.
  it('never rejects when a provider throws synchronously', async () => {
    (globalThis as Record<symbol, unknown>)[PROVIDERS] = {
      tracerProvider: {
        forceFlush: () => {
          throw new Error('provider already shut down');
        },
      },
      meterProvider: { forceFlush: async () => {} },
      loggerProvider: { forceFlush: async () => {} },
    };

    await expect(flushTelemetry()).resolves.toBeUndefined();
    expect(circuitOpen()).toBe(false);
  });

  it('never rejects when a provider throws', async () => {
    // The whole contract of this module: the caller is a request handler that
    // has already done its real work, and a dead collector must not become the
    // user's problem.
    installProviders(async () => {
      throw new Error('collector unreachable');
    });

    await expect(flushTelemetry()).resolves.toBeUndefined();
  });

  it('opens the circuit after three consecutive failures and stops flushing', async () => {
    const providers = installProviders(async () => {
      throw new Error('collector unreachable');
    });

    await flushTelemetry();
    await flushTelemetry();
    expect(circuitOpen()).toBe(false);

    await flushTelemetry();
    expect(circuitOpen()).toBe(true);

    // The point of the breaker is that a container which has learned the
    // endpoint is down stops paying the timeout for the rest of its life, so
    // the fourth call must not reach the exporter at all.
    const callsSoFar = (providers.tracerProvider.forceFlush as ReturnType<typeof vi.fn>).mock.calls.length;
    await flushTelemetry();
    expect((providers.tracerProvider.forceFlush as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(callsSoFar);
  });

  it('counts a fast rejection as a failure, not only a timeout', async () => {
    // A wrong credential is the likeliest misconfiguration here, and it fails
    // instantly rather than slowly. A breaker that only counted timeouts would
    // never trip on it.
    installProviders(() => Promise.reject(new Error('401')));

    await flushTelemetry();
    await flushTelemetry();
    await flushTelemetry();

    expect(circuitOpen()).toBe(true);
  });

  it('resets the failure count after a success, so a blip does not open the circuit', async () => {
    let fail = true;
    installProviders(async () => {
      if (fail) throw new Error('transient');
    });

    await flushTelemetry();
    await flushTelemetry();
    fail = false;
    await flushTelemetry();
    fail = true;
    await flushTelemetry();
    await flushTelemetry();

    expect(circuitOpen()).toBe(false);
  });

  it('returns without waiting when the providers hang, and counts it as a failure', async () => {
    // The bound. Without it an unreachable endpoint stalls every request until
    // the platform timeout, which is the failure ADR-0007 exists to prevent.
    vi.useFakeTimers();
    installProviders(() => new Promise<void>(() => {}));

    const flushed = flushTelemetry();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(flushed).resolves.toBeUndefined();
    expect(circuitOpen()).toBe(false); // one failure, not yet three
  });
});
