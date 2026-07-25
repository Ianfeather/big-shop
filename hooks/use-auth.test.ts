import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@auth0/auth0-react', () => ({ useAuth0: vi.fn(() => ({ marker: 'real-auth0' })) }));

describe('useAuth default export', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves to a fixed mock user when NEXT_PUBLIC_DISABLE_AUTH is true', async () => {
    vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'true');
    const { default: useAuth0, authDisabled } = await import('./use-auth');

    expect(authDisabled).toBe(true);
    const result = useAuth0();
    expect(result.isAuthenticated).toBe(true);
    expect(result.user).toEqual({ sub: 'local-dev-user', name: 'Local Dev', email: 'dev@localhost' });
    await expect(result.getAccessTokenSilently()).resolves.toBe('local-dev-token');
  });

  it('resolves to the real useAuth0 hook otherwise', async () => {
    vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'false');
    const { useAuth0: realUseAuth0 } = await import('@auth0/auth0-react');
    const { default: useAuth0, authDisabled } = await import('./use-auth');

    expect(authDisabled).toBe(false);
    expect(useAuth0).toBe(realUseAuth0);
  });
});
