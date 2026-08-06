import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { serverApiHost } from './api-host';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('serverApiHost', () => {
  it('prefers API_HOST_INTERNAL', () => {
    vi.stubEnv('API_HOST_INTERNAL', 'https://big-shop-api.fly.dev/api/bigshop');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');

    expect(serverApiHost()).toBe('https://big-shop-api.fly.dev/api/bigshop');
  });

  // The misconfiguration this file exists to catch: the operator sets the
  // browser variable in the Netlify UI and forgets the server-side one. A
  // relative path is truthy, so without an explicit check every caller's
  // `if (!host)` guard passes and the failure only surfaces as a fetch that
  // throws with nothing naming the missing variable.
  it('rejects a relative NEXT_PUBLIC_API_HOST rather than returning something unusable', () => {
    vi.stubEnv('API_HOST_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');

    expect(serverApiHost()).toBeUndefined();
  });

  it('names the missing variable when it rejects a relative host', () => {
    vi.stubEnv('API_HOST_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');

    serverApiHost();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('API_HOST_INTERNAL'));
  });

  // Local development and e2e: dev-full.sh sets an absolute NEXT_PUBLIC_API_HOST
  // because there is no proxy in front of `next dev`, so it is a usable
  // server-side value and nothing extra has to be configured.
  it('falls back to NEXT_PUBLIC_API_HOST when API_HOST_INTERNAL is unset', () => {
    vi.stubEnv('API_HOST_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://localhost:8080/api/bigshop');

    expect(serverApiHost()).toBe('http://localhost:8080/api/bigshop');
  });

  it('returns undefined when neither is set, so callers can decide how to fail', () => {
    vi.stubEnv('API_HOST_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '');

    expect(serverApiHost()).toBeUndefined();
  });
});
