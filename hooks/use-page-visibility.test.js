import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import usePageVisibility from './use-page-visibility';

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('usePageVisibility', () => {
  afterEach(() => {
    setHidden(false);
  });

  it('starts visible when the document is not hidden', () => {
    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(true);
  });

  it('updates when the document visibility changes', () => {
    const { result } = renderHook(() => usePageVisibility());

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toBe(false);
  });
});
