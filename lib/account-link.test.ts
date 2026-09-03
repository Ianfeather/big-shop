import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  newNonce,
  rememberPendingLink,
  readPendingLink,
  forgetPendingLink,
  providerLabel,
  accountLinkOffer,
  linkRefusalMessage
} from './account-link';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newNonce', () => {
  // The value that stops a link started by one person being finished by
  // another. Unguessable is the requirement, not merely unlikely.
  it('is long, hex, and different every time', () => {
    const a = newNonce();
    const b = newNonce();

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toEqual(a);
  });

  // Asserted rather than assumed, because the failure is silent: Math.random()
  // produces a string of exactly the same shape and would pass every other test
  // in this file while making the nonce predictable.
  it('comes from crypto.getRandomValues, not Math.random', () => {
    const crypto = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const random = vi.spyOn(Math, 'random');

    newNonce();

    expect(crypto).toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });
});

describe('the pending link', () => {
  const pending = { nonce: 'a'.repeat(64), token: 'b'.repeat(64), provider: 'Apple' };

  it('survives a round trip', () => {
    rememberPendingLink(pending);
    expect(readPendingLink()).toEqual(pending);
  });

  // The confirmation page reads this on every render to know what it is asking
  // about. A read that consumed it would leave the second render - Strict
  // Mode's double invoke, or any re-render - with nothing to name.
  it('is not consumed by reading it', () => {
    rememberPendingLink(pending);

    expect(readPendingLink()).toEqual(pending);
    expect(readPendingLink()).toEqual(pending);
  });

  it('is gone once forgotten', () => {
    rememberPendingLink(pending);
    forgetPendingLink();

    expect(readPendingLink()).toBeNull();
  });

  it('is null when nothing was ever started in this browser', () => {
    expect(readPendingLink()).toBeNull();
  });

  // The whole grant rests on this value being present, so a half-written or
  // stale entry must read as "nothing to finish" rather than being sent to the
  // API as `undefined` - which would fail with a message about a malformed
  // request instead of the honest one.
  it.each([
    ['not JSON at all', 'not json'],
    ['a token with no nonce', JSON.stringify({ token: 'b'.repeat(64) })],
    ['a nonce with no token', JSON.stringify({ nonce: 'a'.repeat(64) })],
    ['the wrong types', JSON.stringify({ nonce: 1, token: 2 })]
  ])('reads as nothing when storage holds %s', (_label, raw) => {
    window.localStorage.setItem('bigshop:pendingLink', raw);

    expect(readPendingLink()).toBeNull();
  });

  // A row written before the provider was recorded, or by a provider the server
  // did not recognise. The link is still completable; only the sentence naming
  // it has to degrade.
  it('tolerates a missing provider', () => {
    window.localStorage.setItem('bigshop:pendingLink', JSON.stringify({
      nonce: 'a'.repeat(64), token: 'b'.repeat(64)
    }));

    expect(readPendingLink()).toEqual({ nonce: 'a'.repeat(64), token: 'b'.repeat(64), provider: '' });
  });

  // Private browsing and quota limits both throw on setItem. Losing the link
  // means it cannot complete and has to be retried - the safe direction, and
  // never a reason to throw out of a click handler.
  it('does not throw when storage refuses to write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => rememberPendingLink(pending)).not.toThrow();
  });
});

describe('providerLabel', () => {
  // The server returns "" rather than guessing at a connection it has no name
  // for, because a raw Auth0 connection name in a sentence somebody is making a
  // security decision about is worse than saying nothing. Both halves have to
  // read as English.
  it('names the provider when there is one', () => {
    expect(providerLabel('Apple')).toBe('your Apple sign-in');
  });

  it('falls back to something true when there is not', () => {
    expect(providerLabel('')).toBe('the way you just signed in');
  });
});

// The most laboured requirement in the spec, and the one that would regress
// silently: the panel must never appear while the recipes query is in flight.
// `useRecipes` defaults to `[]`, so an unresolved query and an empty library
// look identical from the count alone.
describe('accountLinkOffer', () => {
  it('offers nothing while the recipes query is still in flight', () => {
    expect(accountLinkOffer({ recipesResolved: false, recipeCount: 0, hasPendingLink: false }))
      .toBe('none');
  });

  it('offers nothing to somebody who has recipes', () => {
    expect(accountLinkOffer({ recipesResolved: true, recipeCount: 12, hasPendingLink: false }))
      .toBe('none');
  });

  it('offers the start once the query has resolved to an empty library', () => {
    expect(accountLinkOffer({ recipesResolved: true, recipeCount: 0, hasPendingLink: false }))
      .toBe('start');
  });

  // The stranded case: the nonce lives in localStorage and survives a PWA or
  // native-wrapper session boundary, while lib/return-to.ts's sessionStorage
  // navigation to /link/confirm does not. Without this the person lands back on
  // /list signed in as the account that *has* recipes, so nothing on screen
  // points at the link they are halfway through - and there is no way to finish
  // it short of signing out.
  it('offers the finish when a link is pending, even with a full library', () => {
    expect(accountLinkOffer({ recipesResolved: true, recipeCount: 12, hasPendingLink: true }))
      .toBe('finish');
  });

  // The pending link wins outright, including before the query resolves: it is
  // a fact about this browser rather than about the account, so nothing has to
  // load before it can be acted on.
  it('offers the finish before the recipes query has even resolved', () => {
    expect(accountLinkOffer({ recipesResolved: false, recipeCount: 0, hasPendingLink: true }))
      .toBe('finish');
  });
});

// Every refusal is retryable except the populated-account one, and each says
// something different about what to do next - which is the whole reason the
// server answers with a table of them rather than one message.
describe('linkRefusalMessage', () => {
  it('covers all three conflicts without claiming which, on a 409', () => {
    const message = linkRefusalMessage(409);

    expect(message).toContain('same method');
    expect(message).toContain('support');
  });

  it('sends a 400 back to the shopping list to start again', () => {
    expect(linkRefusalMessage(400)).toContain('Start again from your shopping list');
  });

  // Not an ApiError at all - a network failure, say. It must not claim the
  // request was invalid, because nothing says it was.
  it('says only that something went wrong when there is no status', () => {
    const message = linkRefusalMessage(undefined);

    expect(message).toContain('nothing has been linked');
    expect(message).not.toContain('expired');
  });

  // The same rule the server's refusals are held to: naming a provider or an
  // address would turn this into an account-enumeration oracle.
  it.each([409, 400, 500, undefined])('names nobody (status %s)', (status) => {
    const message = linkRefusalMessage(status).toLowerCase();

    for (const word of ['google', 'apple', 'microsoft', '@']) {
      expect(message).not.toContain(word);
    }
  });
});
