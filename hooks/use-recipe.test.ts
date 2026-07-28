import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A fresh QueryClient per test avoids cache bleed between tests/renders -
// TanStack Query caches by queryKey (['recipe', id]) across the whole client.
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

describe('useRecipe', () => {
  it('fetches the recipe by id and returns it', async () => {
    const recipe = { id: 1, name: "Shepherd's Pie", tags: [], ingredients: [] };
    const fetchMock = vi.fn(async () => jsonResponse(recipe));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[0].name).toBe("Shepherd's Pie"));
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/recipe/1', {
      headers: { Authorization: 'Bearer local-dev-token' }
    });
  });

  // A slug is passed straight through as the path segment, the same as an id -
  // the API resolves either.
  it('fetches by slug just as it does by id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ name: 'Veggie Chilli' }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useRecipe } = await import('./use-recipe');
    renderHook(() => useRecipe('veggie-chilli'), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://api.test/recipe/veggie-chilli', expect.anything())
    );
  });

  // Before router.isReady the id is undefined (see hooks/use-recipe-id-param.ts).
  // Fetching then would request /recipe/undefined.
  it('does not fetch when id is undefined', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe(undefined), { wrapper: createWrapper() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current[0]).toEqual({ tags: [], ingredients: [] });
  });

  // Consumers read .tags and .ingredients without guarding, so the placeholder
  // has to carry both as empty arrays until the real thing arrives.
  it('returns the bare-recipe placeholder while the fetch is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe(1), { wrapper: createWrapper() });

    expect(result.current[0]).toEqual({ tags: [], ingredients: [] });
  });
});
