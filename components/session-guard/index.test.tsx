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
const getAccessTokenSilently = vi.hoisted(() => vi.fn<() => Promise<string>>());
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

  it('does the same when the API refuses the token it was given', async () => {
    getAccessTokenSilently.mockResolvedValue('stale-token');
    apiGet.mockRejectedValue(new ApiError('GET /recipes failed with status 401', 401));

    renderWithGuard();

    await waitFor(() => expect(loginWithRedirect).toHaveBeenCalledTimes(1));
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
