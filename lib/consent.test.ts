import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_VERSION, policyLastUpdated, readConsent, writeConsent } from './consent';

// The consent store's read path, which is the part with real decisions in it:
// what counts as "no usable decision", and what must never be read as consent.

beforeEach(() => {
  window.localStorage.clear();
});

describe('readConsent', () => {
  it('is unset on a first visit', () => {
    expect(readConsent()).toBe('unset');
  });

  it('reads back a decision that was written', () => {
    writeConsent('granted');
    expect(readConsent()).toBe('granted');

    writeConsent('denied');
    expect(readConsent()).toBe('denied');
  });

  // The whole reason `unset` exists as a third state. If declining were stored
  // as absence, a visitor who said no would be asked again on every visit.
  it('keeps a declined decision, rather than treating it as never-asked', () => {
    writeConsent('denied');
    expect(readConsent()).toBe('denied');
    expect(readConsent()).not.toBe('unset');
  });

  // The re-asking mechanism: a decision belongs to the text it was made
  // against, so a bumped policy version invalidates it.
  it('is unset again when the decision predates the current policy version', () => {
    window.localStorage.setItem(
      'bigshop:consent',
      JSON.stringify({ analytics: 'granted', version: '2000-01-01' })
    );
    expect(readConsent()).toBe('unset');
  });

  it('is unset when the stored version is missing entirely', () => {
    window.localStorage.setItem('bigshop:consent', JSON.stringify({ analytics: 'granted' }));
    expect(readConsent()).toBe('unset');
  });

  // Every malformed shape has to fail to `unset` - ask again - and never to
  // `granted`. This is the assertion that would catch a refactor deciding to be
  // helpful about partial data.
  it.each([
    ['not json at all', 'nonsense'],
    ['an empty object', '{}'],
    ['a bare string', '"granted"'],
    ['null', 'null'],
    ['an unrecognised decision', JSON.stringify({ analytics: 'maybe', version: POLICY_VERSION })],
    ['a truthy non-decision', JSON.stringify({ analytics: true, version: POLICY_VERSION })],
  ])('is unset when the stored value is %s', (_label, raw) => {
    window.localStorage.setItem('bigshop:consent', raw);
    expect(readConsent()).toBe('unset');
  });

  // A browser with site data blocked throws on access rather than returning
  // null. The page still has to render.
  it('is unset, not an exception, when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });

    expect(readConsent()).toBe('unset');
    getItem.mockRestore();
  });
});

describe('writeConsent', () => {
  it('records the decision against the current policy version', () => {
    writeConsent('granted');
    expect(JSON.parse(window.localStorage.getItem('bigshop:consent') as string)).toEqual({
      analytics: 'granted',
      version: POLICY_VERSION,
    });
  });

  it('does not throw when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });

    expect(() => writeConsent('denied')).not.toThrow();
    setItem.mockRestore();
  });
});

describe('policyLastUpdated', () => {
  // The two are one fact in two formats; this is what stops them drifting.
  it('renders the policy version as a readable date', () => {
    expect(policyLastUpdated('2026-08-16')).toBe('16 August 2026');
  });

  it('defaults to the current policy version', () => {
    expect(policyLastUpdated()).toBe(policyLastUpdated(POLICY_VERSION));
  });
});
