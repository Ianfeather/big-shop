import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

describe('useRecipes (mocks enabled)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns id/name/tags for every mock recipe, dropping other fields', async () => {
    const { default: useRecipes } = await import('./use-recipes');
    const { result } = renderHook(() => useRecipes());

    await waitFor(() => expect(result.current[0]).toHaveLength(2));

    expect(result.current[0]).toEqual([
      { id: 1, name: "Shepherd's Pie", tags: ['Batch Cook'] },
      { id: 2, name: 'Veggie Chilli', tags: ['Vegetarian', 'Batch Cook'] }
    ]);
  });
});
