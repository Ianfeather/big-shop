import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
    const { result } = renderHook(() => useIngredientMetadata());

    await waitFor(() => expect(result.current.units.length).toBeGreaterThan(0));

    expect(result.current.ingredients).toContain('beef mince');
    expect(result.current.units).toContain('gram');
    expect(result.current.units).not.toContain('');
  });
});
