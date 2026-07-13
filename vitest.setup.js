import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver. Tests that need to control resize
// timing themselves (e.g. use-overflow.test.js) stub a fake implementation
// locally, which takes precedence within that file; this is just a no-op
// default so components that merely *use* it (via useOverflow) don't crash.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
