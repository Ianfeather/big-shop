import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  POLICY_VERSION,
  policyLastUpdated,
  readConsent,
  readConsentRecord,
  serializeConsent,
  writeConsent,
} from './consent';

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
      CONSENT_STORAGE_KEY,
      JSON.stringify({ analytics: 'granted', version: '2000-01-01' })
    );
    expect(readConsent()).toBe('unset');
  });

  it('is unset when the stored version is missing entirely', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ analytics: 'granted' }));
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
    window.localStorage.setItem(CONSENT_STORAGE_KEY, raw);
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
    writeConsent('granted', 'banner', '2026-08-16T09:00:00.000Z');
    expect(JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) as string)).toEqual({
      analytics: 'granted',
      version: POLICY_VERSION,
      source: 'banner',
      decidedAt: '2026-08-16T09:00:00.000Z',
    });
  });

  // The source has to survive in the browser, because by the time the sync
  // pushes the decision up - possibly days later, at login - the control that
  // produced it is long gone and cannot be inferred from the request.
  it('keeps how the decision was given', () => {
    writeConsent('denied', 'settings', '2026-08-16T09:00:00.000Z');
    expect(readConsentRecord()).toEqual({
      analytics: 'denied',
      version: POLICY_VERSION,
      source: 'settings',
      decidedAt: '2026-08-16T09:00:00.000Z',
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

describe('readConsentRecord', () => {
  // The two readers must never disagree about whether a decision exists - the
  // banner asks one and the sync asks the other, and a split would mean a
  // dismissed banner that still gets pushed up, or the reverse.
  it('agrees with readConsent about whether there is a decision', () => {
    expect(readConsentRecord()).toBeNull();
    expect(readConsent()).toBe('unset');

    writeConsent('granted');
    expect(readConsentRecord()?.analytics).toBe('granted');
    expect(readConsent()).toBe('granted');

    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      serializeConsent('granted', 'banner', '2000-01-01')
    );
    expect(readConsentRecord()).toBeNull();
    expect(readConsent()).toBe('unset');
  });

  // Provenance is worth less than the decision: a future fourth source must not
  // cost someone their recorded answer.
  it('keeps the decision when the source is unrecognised', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ analytics: 'denied', version: POLICY_VERSION, source: 'carrier-pigeon' })
    );

    expect(readConsentRecord()).toMatchObject({
      analytics: 'denied',
      version: POLICY_VERSION,
      source: 'banner',
    });
  });

  // A record written before decidedAt existed still has to reconcile. Treating
  // it as maximally old means the server's copy wins, which is the safe
  // direction - the alternative is discarding a real decision over a missing
  // field.
  it('treats a decision with no timestamp as the oldest possible', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ analytics: 'granted', version: POLICY_VERSION, source: 'banner' })
    );

    expect(readConsentRecord()?.decidedAt).toBe(new Date(0).toISOString());
    expect(readConsent()).toBe('granted');
  });

  it('is null, not an exception, when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });

    expect(readConsentRecord()).toBeNull();
    getItem.mockRestore();
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
