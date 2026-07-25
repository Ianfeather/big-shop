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

describe('useRecipe (mocks enabled)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('finds a mock recipe by id', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[0].name).toBe("Shepherd's Pie"));
  });

  it('finds a mock recipe by slug', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe('veggie-chilli'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[0].name).toBe('Veggie Chilli'));
  });

  it('keeps the bare-recipe default when no mock matches', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe('does-not-exist'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current[0]).toEqual({ tags: [], ingredients: [] }));
  });

  it('does not look anything up when id is undefined', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe(undefined), { wrapper: createWrapper() });

    expect(result.current[0]).toEqual({ tags: [], ingredients: [] });
  });
});

describe('useRecipe (mocks disabled)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not fetch when id is undefined', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    renderHook(() => useRecipe(undefined), { wrapper: createWrapper() });

    expect(fetch).not.toHaveBeenCalled();
  });
});
