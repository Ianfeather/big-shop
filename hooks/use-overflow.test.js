import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import useOverflow from './use-overflow';

let observedCallback;

class FakeResizeObserver {
  constructor(callback) {
    observedCallback = callback;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function TestTarget() {
  const [ref, isOverflowing] = useOverflow([]);
  return <div ref={ref} data-testid="target">{isOverflowing ? 'overflowing' : 'fine'}</div>;
}

describe('useOverflow', () => {
  it('is not overflowing when content fits its box', () => {
    render(<TestTarget />);

    expect(screen.getByTestId('target')).toHaveTextContent('fine');
  });

  it('flags overflow once the ResizeObserver reports scrollWidth beyond clientWidth', () => {
    render(<TestTarget />);
    const el = screen.getByTestId('target');
    Object.defineProperty(el, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });

    act(() => {
      observedCallback();
    });

    expect(screen.getByTestId('target')).toHaveTextContent('overflowing');
  });
});
