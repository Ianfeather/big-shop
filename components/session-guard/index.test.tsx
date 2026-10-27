import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import SessionGuard from './index';
import useRecipes from '@hooks/use-recipes';
import { ApiError } from '../../lib/api-client';
import { consumeReturnTo } from '../../lib/return-to';

// The bug: Auth0 stops issuing tokens (the refresh token has expired) while
// still reporting the user as logged in, and every list renders empty with no
// way out but logging out and in again. See lib/session-expiry.ts.

const loginWithRedirect = vi.hoisted(() => vi.fn(async () => {}));
const logout = vi.hoisted(() => vi.fn(async () => {}));
const getAccessTokenSilently = vi.hoisted(() => vi.fn<(options?: { cacheMode?: string }) => Promise<string>>());
vi.mock('@hooks/use-auth', () => ({
  default: () => ({ isAuthenticated: true, loginWithRedirect, logout, getAccessTokenSilently }),
}));

vi.mock('next/router', () => ({ useRouter: () => ({ asPath: '/recipes/42' }) }));

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api-client')>()),
  apiGet,
}));

// What auth0-spa-js throws when the refresh grant is refused: a GenericError,
// which carries the OAuth error code on `error`.
const invalidGrant = () =>
  Object.assign(new Error('Unknown or invalid refresh token.'), { error: 'invalid_grant' });

function RecipesPage() {
  useRecipes();
  return null;
}

function renderWithGuard(children = <RecipesPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionGuard />
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  loginWithRedirect.mockClear();
  logout.mockClear();
  getAccessTokenSilently.mockReset();
  apiGet.mockReset();
});

describe('SessionGuard', () => {
  it('sends the user back through login when Auth0 can no longer issue a token', async () => {
    getAccessTokenSilently.mockRejectedValue(invalidGrant());

    renderWithGuard();

    await waitFor(() => expect(loginWithRedirect).toHaveBeenCalledTimes(1));
    expect(logout).not.toHaveBeenCalled();
    // And comes back to the page they were on, not /list.
    expect(consumeReturnTo()).toBe('/recipes/42');
  });

  // Layer 1: a 401 means the cached token was refused. Get a new one and
  // refetch before involving the user at all.
  describe('when the API refuses the token it was given', () => {
    const unauthorized = () => new ApiError('GET /recipes failed with status 401', 401);

    it('silently fetches a fresh token and refetches, without a redirect', async () => {
      getAccessTokenSilently.mockResolvedValue('token');
      apiGet.mockRejectedValueOnce(unauthorized()).mockResolvedValue([{ id: 1, name: 'Pie', tags: [] }]);

      renderWithGuard();

      await waitFor(() => expect(getAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' }));
      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
      await new Promise((r) => setTimeout(r, 20));
      expect(loginWithRedirect).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    });

    it('redirects to log in if the fresh token is refused too', async () => {
      getAccessTokenSilently.mockResolvedValue('token');
      apiGet.mockRejectedValue(unauthorized());

      renderWithGuard();

      await waitFor(() => expect(loginWithRedirect).toHaveBeenCalledTimes(1));
      expect(getAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' });
      expect(apiGet).toHaveBeenCalledTimes(2);
    });

    it('redirects to log in if a fresh token cannot be had', async () => {
      getAccessTokenSilently.mockImplementation(async (options?: { cacheMode?: string }) => {
        if (options?.cacheMode === 'off') throw invalidGrant();
        return 'stale-token';
      });
      apiGet.mockRejectedValue(unauthorized());

      renderWithGuard();

      await waitFor(() => expect(loginWithRedirect).toHaveBeenCalledTimes(1));
    });

    it('stays put if the refresh fails for some other reason, such as the network', async () => {
      getAccessTokenSilently.mockImplementation(async (options?: { cacheMode?: string }) => {
        if (options?.cacheMode === 'off') throw new TypeError('Failed to fetch');
        return 'stale-token';
      });
      apiGet.mockRejectedValue(unauthorized());

      renderWithGuard();

      await waitFor(() => expect(getAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(loginWithRedirect).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    });
  });

  it('catches it on a mutation too, for a page whose data loaded before the session lapsed', async () => {
    function MarkBought() {
      const m = useMutation({ mutationFn: () => Promise.reject(invalidGrant()) });
      useEffect(() => m.mutate(), []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }

    renderWithGuard(<MarkBought />);

    await waitFor(() => expect(loginWithRedirect).toHaveBeenCalledTimes(1));
  });

  it('leaves an ordinary failure alone', async () => {
    getAccessTokenSilently.mockResolvedValue('token');
    apiGet.mockRejectedValue(new ApiError('GET /recipes failed with status 500', 500));

    renderWithGuard();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(loginWithRedirect).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out locally instead of redirecting again if a fresh login was refused too', async () => {
    window.sessionStorage.setItem('bigshop:reauthAt', String(Date.now() - 10_000));
    getAccessTokenSilently.mockRejectedValue(invalidGrant());

    renderWithGuard();

    await waitFor(() => expect(logout).toHaveBeenCalledWith({ openUrl: false }));
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });
});
