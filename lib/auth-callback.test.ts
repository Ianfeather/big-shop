import { describe, it, expect, vi, afterEach } from 'vitest';
import { CacheKey } from '@auth0/auth0-spa-js';

// `arrivedFromLogin` is computed once at module evaluation, on purpose - see
// lib/auth-callback.ts for why it cannot wait for a component. That makes it
// awkward to test in the usual way and easy to test in this one: set the URL,
// reset the module registry, import it again.
async function loadWith(search: string): Promise<boolean> {
  vi.resetModules();
  window.history.replaceState({}, '', `/${search}`);
  return (await import('./auth-callback')).arrivedFromLogin;
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('arrivedFromLogin', () => {
  it('is true for an Auth0 callback, which carries both code and state', async () => {
    expect(await loadWith('?code=abc123&state=xyz789')).toBe(true);
  });

  it('is false for someone typing the bare domain', async () => {
    expect(await loadWith('')).toBe(false);
  });

  // The distinction the homepage now hangs its only redirect on. A visitor who
  // did not come from Auth0 stays on `/`, so anything that reads as a callback
  // when it is not would put the flash straight back.
  it('is false for an unrelated query string', async () => {
    expect(await loadWith('?utm_source=newsletter&ref=twitter')).toBe(false);
  });

  it('needs both params, not either', async () => {
    expect(await loadWith('?code=abc123')).toBe(false);
    expect(await loadWith('?state=xyz789')).toBe(false);
  });

  // Substring matching on 'code=' would call this a callback. It is not one -
  // it is a discount code and a US state on a marketing link - and treating it
  // as one would redirect a first-time visitor into an account they do not
  // have. This is why both sides parse the query rather than searching it.
  it('is false for params that merely contain the words', async () => {
    expect(await loadWith('?promocode=SUMMER&estate=CA')).toBe(false);
  });
});

// The inline script in pages/_document.tsx matches localStorage keys against
// '@@auth0spajs@@::<clientId>'. That string is auth0-spa-js's internal cache
// format, and this test is what stops an SDK upgrade quietly turning the
// pre-paint hint into a no-op: the failure mode otherwise is invisible, since
// finding nothing is indistinguishable from a logged-out visitor and the page
// simply goes back to flashing.
//
// CacheKey is a public export of the package, so this asserts against the real
// thing rather than against a copy of the constant.
describe('the localStorage prefix the pre-paint hint matches on', () => {
  it('is what auth0-spa-js actually writes', () => {
    const clientId = 'HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G';
    const key = new CacheKey({
      clientId,
      audience: 'https://api.bigshop.life',
      scope: 'openid profile email',
    }).toKey();

    expect(key.startsWith(`@@auth0spajs@@::${clientId}`)).toBe(true);
  });
});
