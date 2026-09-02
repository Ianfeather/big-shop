import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// NEXT_PUBLIC_DISABLE_AUTH makes hooks/use-auth resolve to its fixed mock user
// instead of useAuth0, which would need a real Auth0Provider mounted above the
// hook. Read at module load, hence resetModules + the dynamic import below.
//
// `arrivedFromLogin` is also module-scope (lib/auth-callback.ts), computed from
// the URL when the bundle is first evaluated - so the URL has to be set before
// the import too. Both facts are why every case here loads the hook itself.
async function loadHook(search: string) {
  vi.resetModules();
  window.history.replaceState({}, '', `/list${search}`);
  return (await import('./use-account-setup')).default;
}

const AUTH0_CALLBACK = '?code=abc123&state=xyz789';

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('useAccountSetup', () => {
  it('creates the account on the way in from Auth0', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'local-dev-user', onboarded: true }));
    vi.stubGlobal('fetch', fetchMock);

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    renderHook(() => useAccountSetup());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/user');
    expect(init.method).toBe('POST');
  });

  // The reason this hook exists. POST /user is what creates the `account_user`
  // row, and internal/pkg/common/caller.go turns a missing one into a 500 - so
  // a brand new user who reached /list before it returned would watch every
  // request on their first ever screen fail. Rendering has to wait.
  it('holds the render until the account exists', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await pending;
      return jsonResponse({ id: 'local-dev-user', onboarded: true });
    }));

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    const { result } = renderHook(() => useAccountSetup());

    expect(result.current.accountReady).toBe(false);

    release();
    await waitFor(() => expect(result.current.accountReady).toBe(true));
  });

  // The other half of the trade. Waiting on every launch would put a blank
  // frame in front of the app opening, which is the thing this whole change
  // exists to make feel immediate - and by then the account either exists or
  // never will, so there is nothing to wait for.
  it('does not hold the render on an ordinary launch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => {})));

    const useAccountSetup = await loadHook('');
    const { result } = renderHook(() => useAccountSetup());

    expect(result.current.accountReady).toBe(true);
  });

  // Stranding someone on a permanently blank screen is worse than letting the
  // page load and fail visibly, and the next launch runs the repair again.
  it('releases the render when the upsert fails rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    const { result } = renderHook(() => useAccountSetup());

    await waitFor(() => expect(result.current.accountReady).toBe(true));
  });

  // `onboarded` is recorded and routes nobody. It used to decide whether a
  // first-time user was forwarded to /list or left on the marketing homepage;
  // everyone goes to /list now, so the only thing left to do with the flag is
  // set it. If this ever starts gating navigation again, the PWA stops opening
  // where it says it does for exactly the people least able to explain why.
  it('marks a new user onboarded without that changing where they land', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'local-dev-user', onboarded: false }));
    vi.stubGlobal('fetch', fetchMock);

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    const { result } = renderHook(() => useAccountSetup());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/user/onboarding');
    expect(init.method).toBe('PATCH');

    // Not "and then redirects somewhere": the hook reports readiness and owns
    // no navigation at all.
    await waitFor(() => expect(result.current.accountReady).toBe(true));
  });

  // The server takes the address from a verified claim on the access token and
  // has no email field on this request at all. Sending one would be inert, but
  // it would also be the thing that used to be an authorisation input - so this
  // pins its absence rather than leaving the next reader to wonder whether the
  // omission was deliberate.
  it('does not send an email address the server would have to ignore', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'local-dev-user', onboarded: true }));
    vi.stubGlobal('fetch', fetchMock);

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    renderHook(() => useAccountSetup());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('email');
  });

  it('leaves an already-onboarded user alone', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'local-dev-user', onboarded: true }));
    vi.stubGlobal('fetch', fetchMock);

    const useAccountSetup = await loadHook(AUTH0_CALLBACK);
    const { result } = renderHook(() => useAccountSetup());

    await waitFor(() => expect(result.current.accountReady).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
