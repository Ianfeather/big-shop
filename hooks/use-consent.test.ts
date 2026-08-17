import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useConsent from './use-consent';
import { CONSENT_STORAGE_KEY, serializeConsent } from '../lib/consent';

// The hook's own claims, as distinct from lib/consent's read/write rules: that
// it paints the stored decision on the very first render, and that two tabs
// agree. Both were asserted only in a comment before this existed.

beforeEach(() => {
  window.localStorage.clear();
});

describe('useConsent', () => {
  // The no-flash guarantee. Seeding from an effect would render `unset` first
  // and correct it a tick later, which is the banner appearing and vanishing on
  // every visit for someone who decided months ago.
  it('reports a stored decision on the first render, not after an effect', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('granted'));

    const { result } = renderHook(() => useConsent());

    expect(result.current[0]).toBe('granted');
  });

  it('is unset when nothing has been decided', () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current[0]).toBe('unset');
  });

  it('re-renders with the new value when a decision is made', () => {
    const { result } = renderHook(() => useConsent());

    act(() => result.current[1]('denied'));

    expect(result.current[0]).toBe('denied');
  });

  // The cross-tab claim in the hook's header. The `storage` event only fires in
  // *other* tabs, so this is the path a local write can't exercise: another tab
  // accepts, and this one has to stop showing the banner.
  it('adopts a decision made in another tab', () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current[0]).toBe('unset');

    act(() => {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('granted'));
      window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    });

    expect(result.current[0]).toBe('granted');
  });

  // Two components reading the same store must not disagree - one accepting has
  // to move both, in the tab that did it, where no `storage` event fires.
  it('keeps two consumers in the same tab in step', () => {
    const first = renderHook(() => useConsent());
    const second = renderHook(() => useConsent());

    act(() => first.result.current[1]('granted'));

    expect(first.result.current[0]).toBe('granted');
    expect(second.result.current[0]).toBe('granted');
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useConsent());
    unmount();

    // No assertion beyond "this does not throw": a listener left attached to a
    // torn-down component is what React warns about, and the cleanup returned
    // by subscribe is what prevents it.
    expect(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    }).not.toThrow();
  });
});
