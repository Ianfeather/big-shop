import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const jsonResponse = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });

// See use-recipes.test.ts: NEXT_PUBLIC_DISABLE_AUTH is read at module load.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function load() {
  const mod = await import('./use-similar-recipes');
  return mod;
}

describe('useSimilarRecipes', () => {
  it('asks the API once typing settles, with the candidates sorted, and returns its matches', async () => {
    const matches = [{ id: 7, probability: 0.9 }];
    const fetchMock = vi.fn(async () => jsonResponse({ matches }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useSimilarRecipes } = await load();
    const { result } = renderHook(() => useSimilarRecipes(' curry ', [9, 7, 3]), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current).toEqual(matches));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/recipes/similar');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer local-dev-token');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'curry', candidateIds: [3, 7, 9] });
  });

  it('sends one request for a word typed quickly, not one per keystroke', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ matches: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useSimilarRecipes, SIMILAR_DEBOUNCE_MS } = await load();
    const { rerender } = renderHook(({ q }) => useSimilarRecipes(q, [1, 2]), {
      wrapper: createWrapper(),
      initialProps: { q: 'cur' }
    });
    rerender({ q: 'curr' });
    rerender({ q: 'curry' });

    await sleep(SIMILAR_DEBOUNCE_MS * 2);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).query).toBe('curry');
  });

  it('does not ask about a search under three characters', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ matches: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useSimilarRecipes, SIMILAR_DEBOUNCE_MS } = await load();
    const { result } = renderHook(() => useSimilarRecipes(' cu  ', [1]), { wrapper: createWrapper() });

    await sleep(SIMILAR_DEBOUNCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('does not ask when there is nothing left to judge', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ matches: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useSimilarRecipes, SIMILAR_DEBOUNCE_MS } = await load();
    renderHook(() => useSimilarRecipes('curry', []), { wrapper: createWrapper() });

    await sleep(SIMILAR_DEBOUNCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Similar Recipes are additive: a failure is the tranche being absent, not
  // an error anyone is shown.
  it('answers a failed request with no matches', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    const { default: useSimilarRecipes } = await load();
    const { result } = renderHook(() => useSimilarRecipes('curry', [1]), { wrapper: createWrapper() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await sleep(20);
    expect(result.current).toEqual([]);
  });

  // The previous search's matches under the new search's Exact Matches would
  // be the wrong answer, so nothing shows until the new one arrives.
  it('shows nothing for a new search until its own answer arrives', async () => {
    let answer = [{ id: 1, probability: 0.9 }];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ matches: answer })));

    const { default: useSimilarRecipes } = await load();
    const { result, rerender } = renderHook(({ q }) => useSimilarRecipes(q, [1, 2]), {
      wrapper: createWrapper(),
      initialProps: { q: 'curry' }
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    answer = [{ id: 2, probability: 0.8 }];
    rerender({ q: 'soup' });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(answer));
  });
});
