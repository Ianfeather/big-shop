import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseRouter = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => mockUseRouter() }));

import useRecipeIdParam from './use-recipe-id-param';

describe('useRecipeIdParam', () => {
  it('returns undefined before the router is ready, even if query already has an id', () => {
    mockUseRouter.mockReturnValue({ isReady: false, query: { id: '42' } });

    const { result } = renderHook(() => useRecipeIdParam());

    expect(result.current).toBeUndefined();
  });

  it('returns the id once the router is ready', () => {
    mockUseRouter.mockReturnValue({ isReady: true, query: { id: '42' } });

    const { result } = renderHook(() => useRecipeIdParam());

    expect(result.current).toBe('42');
  });
});
