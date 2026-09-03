import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A fresh QueryClient per test avoids cache bleed between tests/renders -
// TanStack Query caches by queryKey (['recipes']) across the whole client.
function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const jsonResponse = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });

// NEXT_PUBLIC_DISABLE_AUTH makes hooks/use-auth resolve to its fixed mock user
// instead of useAuth0, which would need a real Auth0Provider mounted above the
// hook. Read at module load, hence resetModules + the dynamic import below.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('useRecipes', () => {
  it('returns what the API returns', async () => {
    const recipes = [
      { id: 1, name: "Shepherd's Pie", tags: ['Batch Cook'] },
      { id: 2, name: 'Veggie Chilli', tags: ['Vegetarian', 'Batch Cook'] }
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(recipes)));

    const { default: useRecipes } = await import('./use-recipes');
    const { result } = renderHook(() => useRecipes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[0]).toHaveLength(2));
    expect(result.current[0]).toEqual(recipes);
  });

  it('requests /recipes with a bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useRecipes } = await import('./use-recipes');
    renderHook(() => useRecipes(), { wrapper: createWrapper() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/recipes', {
      headers: { Authorization: 'Bearer local-dev-token' }
    });
  });

  // Consumers destructure and map this immediately, so `undefined` while the
  // request is in flight would throw rather than render an empty list.
  it('returns an empty list rather than undefined before the fetch resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const { default: useRecipes } = await import('./use-recipes');
    const { result } = renderHook(() => useRecipes(), { wrapper: createWrapper() });

    expect(result.current[0]).toEqual([]);
  });

  // The point of the second element, and the reason it had to exist: the list
  // above is `[]` in both of the next two tests, so nothing about it can tell
  // "still loading" from "this account genuinely has no recipes". Anything that
  // renders a message about an empty library has to read the flag instead, or
  // it shows that message to everybody on every load.
  it('reports an in-flight query as unresolved, alongside the same empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const { default: useRecipes } = await import('./use-recipes');
    const { result } = renderHook(() => useRecipes(), { wrapper: createWrapper() });

    expect(result.current[0]).toEqual([]);
    expect(result.current[1]).toBe(false);
  });

  it('reports a query that came back empty as resolved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));

    const { default: useRecipes } = await import('./use-recipes');
    const { result } = renderHook(() => useRecipes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[1]).toBe(true));
    expect(result.current[0]).toEqual([]);
  });
});
