import { describe, it, expect, beforeEach } from 'vitest';
import { isSafeReturnTo, rememberReturnTo, consumeReturnTo } from './return-to';

// The open-redirect cases are the reason this module exists as its own file
// rather than as two lines inside the gate. The value arrives from the address
// bar, so a link can carry whatever it likes into it - and a login flow that
// can be steered to another origin is a phishing primitive wearing our domain
// and our Auth0 tenant.
//
// Note that none of this can be covered end to end: NEXT_PUBLIC_DISABLE_AUTH
// makes hooks/use-auth.ts report `isAuthenticated: true` unconditionally, so
// the gate never fires under e2e and the logged-out journey is unreachable
// there. These tests are the coverage, not a supplement to it.
describe('isSafeReturnTo', () => {
  it.each([
    ['/recipes/add/pasta-e-ceci'],
    ['/list'],
    ['/recipes/12/edit?stored=updated'],
    ['/recipes/add/x#ingredients'],
  ])('accepts the relative path %s', (path) => {
    expect(isSafeReturnTo(path)).toBe(true);
  });

  it.each([
    // The plain case.
    ['https://evil.example/steal'],
    ['http://evil.example'],
    // Protocol-relative: passes a naive "starts with a slash" test and is a
    // fully qualified URL. The one most often missed.
    ['//evil.example'],
    ['//evil.example/recipes'],
    // Browsers have historically normalised backslashes to forward slashes, so
    // these reach the same place as the protocol-relative pair above.
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['/recipes\\..\\..'],
    // Schemes that are not navigation at all.
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    // Not anchored anywhere we chose - resolves against wherever the reader is.
    ['recipes/add/x'],
    ['../account'],
    [''],
  ])('rejects %s', (path) => {
    expect(isSafeReturnTo(path)).toBe(false);
  });

  it('rejects values that are not strings at all', () => {
    // sessionStorage returns null for a key that was never set, and the value
    // could have been written by an older build in the same tab.
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo({ toString: () => '/list' })).toBe(false);
  });
});

describe('remembering a destination', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('survives the round trip', () => {
    rememberReturnTo('/recipes/add/pasta-e-ceci');

    expect(consumeReturnTo()).toBe('/recipes/add/pasta-e-ceci');
  });

  it('is consumed, so a later login in the same tab is not sent somewhere stale', () => {
    rememberReturnTo('/recipes/add/pasta-e-ceci');
    consumeReturnTo();

    expect(consumeReturnTo()).toBeNull();
  });

  it('reports nothing when nothing was remembered', () => {
    expect(consumeReturnTo()).toBeNull();
  });

  // Storing it would make an ordinary login - which lands here anyway - look
  // like a deep link that had been interrupted, and send them to `/` instead of
  // into the product.
  it('does not remember the homepage', () => {
    rememberReturnTo('/');

    expect(consumeReturnTo()).toBeNull();
  });

  it('refuses to store an unsafe path in the first place', () => {
    rememberReturnTo('//evil.example');

    expect(consumeReturnTo()).toBeNull();
  });

  // Belt and braces: the check on the way out has to stand on its own, because
  // the value can also have been written by an older build still live in this
  // tab.
  it('refuses an unsafe path on the way out, however it got there', () => {
    window.sessionStorage.setItem('bigshop:returnTo', 'https://evil.example');

    expect(consumeReturnTo()).toBeNull();
  });
});
