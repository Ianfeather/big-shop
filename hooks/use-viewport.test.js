import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useViewport from './use-viewport';

describe('useViewport', () => {
  it('reports the current window width on mount', () => {
    window.innerWidth = 1024;

    const { result } = renderHook(() => useViewport());

    expect(result.current.width).toBe(1024);
  });

  it('updates when the window is resized', () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useViewport());

    act(() => {
      window.innerWidth = 500;
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.width).toBe(500);
  });
});
