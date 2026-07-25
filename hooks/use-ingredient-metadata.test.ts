import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A fresh QueryClient per test avoids cache bleed between tests/renders -
// TanStack Query caches by queryKey (['units'], ['ingredients']) across the
// whole client.
function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useIngredientMetadata (mocks enabled)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes ingredient and unit names, dropping blank unit names', async () => {
    const { default: useIngredientMetadata } = await import('./use-ingredient-metadata');
    const { result } = renderHook(() => useIngredientMetadata(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.units.length).toBeGreaterThan(0));

    expect(result.current.ingredients).toContain('beef mince');
    expect(result.current.units).toContain('gram');
    expect(result.current.units).not.toContain('');
  });
});
