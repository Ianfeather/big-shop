import { describe, it, expect, afterEach, vi } from 'vitest';
import { appOrigin, loginRedirectUri } from './app-origin';

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

describe('loginRedirectUri', () => {
  // The installed PWA launches at /list (public/manifest.json's start_url).
  // If the callback ever points at the origin root again, finishing a login
  // drops the user on the marketing homepage inside a standalone window with
  // no address bar, and nothing forwards them on any more - pages/index.tsx's
  // redirect was removed precisely because this became the only mechanism.
  it('sends a finished login to /list, not the origin root', () => {
    expect(loginRedirectUri()).toBe(`${window.location.origin}/list`);
  });

  // Same reasoning as appOrigin's first test: a preview must send the user
  // back to the preview, on the right path.
  it('follows the browser origin rather than the build-time host', () => {
    vi.stubEnv('NEXT_PUBLIC_HOST', 'https://www.bigshop.life');

    expect(loginRedirectUri()).not.toContain('www.bigshop.life');
    expect(loginRedirectUri()).toBe(`${window.location.origin}/list`);
  });

  it('is undefined rather than a bare "/list" when there is no origin', () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('NEXT_PUBLIC_HOST', '');

    expect(loginRedirectUri()).toBeFalsy();
  });
});
