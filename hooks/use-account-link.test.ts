import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The navigation is the thing these tests are really about, so it is a spy
// rather than a real router. Hoisted because vi.mock is hoisted above the
// imports it replaces.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn(async () => true) }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock }) }));

function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const jsonResponse = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });

// NEXT_PUBLIC_DISABLE_AUTH makes hooks/use-auth resolve to its fixed mock user
// rather than useAuth0, which would need a real Auth0Provider mounted above the
// hook. Read at module load, hence resetModules + the dynamic imports below.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  window.localStorage.clear();
  window.sessionStorage.clear();
  pushMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useStartAccountLink', () => {
  it('asks the server to start a link, sending a nonce and nothing else', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ token: 'tok', provider: 'Apple' }));
    vi.stubGlobal('fetch', fetchMock);

    const { useStartAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useStartAccountLink(), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/link/start');
    expect(init.method).toBe('POST');

    // **The body cannot name a subject.** The identity a completed link grants
    // access to is always the caller's own, taken from the validated token
    // server-side - a field for it here would let a caller start a link that
    // hands some stranger's login their account. `app.LinkStartInput` has no
    // such field and a Go test pins that structurally; this is the same
    // assertion from the other end of the wire.
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body)).toEqual(['nonce']);
    expect(body.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  // **The ordering is the security property.** Once the browser navigates the
  // page is gone and nothing else gets the chance to write anything, so a nonce
  // stored after the redirect is a nonce that never exists - and the completion
  // would be refused with nothing to explain why.
  it('stores the nonce and token before navigating anywhere', async () => {
    let storedWhenNavigated: string | null = null;
    pushMock.mockImplementation(async () => {
      storedWhenNavigated = window.localStorage.getItem('bigshop:pendingLink');
      return true;
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ token: 'tok', provider: 'Apple' })));

    const { useStartAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useStartAccountLink(), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(storedWhenNavigated).not.toBeNull();
    expect(JSON.parse(storedWhenNavigated!)).toMatchObject({ token: 'tok', provider: 'Apple' });
  });

  // The nonce the server was told about has to be the one kept here, or the
  // digests cannot match and every link fails at the last step.
  it('keeps the same nonce it sent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ token: 'tok', provider: 'Apple' }));
    vi.stubGlobal('fetch', fetchMock);

    const { useStartAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useStartAccountLink(), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).nonce;
    const kept = JSON.parse(window.localStorage.getItem('bigshop:pendingLink')!).nonce;
    expect(kept).toBe(sent);
  });

  // The return-to is what carries the browser from the Auth0 callback on /list
  // to the confirmation. It is a convenience rather than the only thread - the
  // Shopping List offers a way back when it is lost - but on the web it is the
  // path everybody actually takes.
  it('remembers where to go after the callback lands on /list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ token: 'tok', provider: 'Apple' })));

    const { useStartAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useStartAccountLink(), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('bigshop:returnTo')).toBe('/link/confirm');
  });

  // Nothing is stored if the server refused to start one. A token-less nonce
  // sitting in storage would make the Shopping List offer to "finish" a link
  // that does not exist.
  it('stores nothing when the server refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));

    const { useStartAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useStartAccountLink(), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(window.localStorage.getItem('bigshop:pendingLink')).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('useCompleteAccountLink', () => {
  const pending = { nonce: 'a'.repeat(64), token: 'b'.repeat(64), provider: 'Apple' };

  it('sends the token and the nonce, and nothing about who to link', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ provider: 'Apple' }));
    vi.stubGlobal('fetch', fetchMock);

    const { useCompleteAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useCompleteAccountLink(), { wrapper: createWrapper() });
    result.current.mutate(pending);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/link/complete');
    // The subject being granted access comes from the server's own row. There
    // is deliberately no way to spell a completion that redirects it.
    expect(JSON.parse(init.body as string)).toEqual({ token: pending.token, nonce: pending.nonce });
  });

  it('forgets the pending link once it has completed', async () => {
    window.localStorage.setItem('bigshop:pendingLink', JSON.stringify(pending));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ provider: 'Apple' })));

    const { useCompleteAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useCompleteAccountLink(), { wrapper: createWrapper() });
    result.current.mutate(pending);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(window.localStorage.getItem('bigshop:pendingLink')).toBeNull();
  });

  // **Kept on failure, deliberately.** Several of the server's refusals are
  // retryable - an expired request, or coming back with the provider you were
  // already using - and clearing here would turn "try again and choose the
  // other one" into a journey restarted from the shopping list.
  it('keeps the pending link when the server refuses', async () => {
    window.localStorage.setItem('bigshop:pendingLink', JSON.stringify(pending));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, text: async () => '' })));

    const { useCompleteAccountLink } = await import('./use-account-link');
    const { result } = renderHook(() => useCompleteAccountLink(), { wrapper: createWrapper() });
    result.current.mutate(pending);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(window.localStorage.getItem('bigshop:pendingLink')).not.toBeNull();
  });
});
