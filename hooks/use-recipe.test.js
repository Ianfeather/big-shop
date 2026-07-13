import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
    const { result } = renderHook(() => useRecipe(1));

    await waitFor(() => expect(result.current[0].name).toBe("Shepherd's Pie"));
  });

  it('finds a mock recipe by slug', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe('veggie-chilli'));

    await waitFor(() => expect(result.current[0].name).toBe('Veggie Chilli'));
  });

  it('keeps the bare-recipe default when no mock matches', async () => {
    const { default: useRecipe } = await import('./use-recipe');
    const { result } = renderHook(() => useRecipe('does-not-exist'));

    expect(result.current[0]).toEqual({ tags: [], ingredients: [] });
  });
});
