import { describe, it, expect, afterEach, vi } from 'vitest';
import { appOrigin } from './app-origin';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('appOrigin', () => {
  // The whole point of follow-ups.md #48: a deploy preview is served from
  // deploy-preview-<N>--big-shop.netlify.app, but every production-mode build
  // inlines the same NEXT_PUBLIC_HOST. If the build-time value ever wins in the
  // browser again, login redirects leave the preview for production and the
  // preview cannot be tested past the login screen.
  it('prefers the browser origin over the build-time host', () => {
    vi.stubEnv('NEXT_PUBLIC_HOST', 'https://www.bigshop.life');

    expect(appOrigin()).toBe(window.location.origin);
    expect(appOrigin()).not.toBe('https://www.bigshop.life');
  });

  it('falls back to NEXT_PUBLIC_HOST when there is no window', () => {
    vi.stubEnv('NEXT_PUBLIC_HOST', 'https://www.bigshop.life');
    vi.stubGlobal('window', undefined);

    expect(appOrigin()).toBe('https://www.bigshop.life');
  });
});
