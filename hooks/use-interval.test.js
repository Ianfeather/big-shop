import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useInterval from './use-interval';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useInterval', () => {
  it('calls the callback on the given delay while the page is visible', () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, 1000));

    vi.advanceTimersByTime(3500);

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('does not tick when the page is hidden and pauseOnHide is true', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const callback = vi.fn();

    renderHook(() => useInterval(callback, 1000));
    vi.advanceTimersByTime(5000);

    expect(callback).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('still ticks when the page is hidden if pauseOnHide is false', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const callback = vi.fn();

    renderHook(() => useInterval(callback, 1000, false));
    vi.advanceTimersByTime(2500);

    expect(callback).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
});
