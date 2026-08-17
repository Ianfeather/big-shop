import { useCallback, useSyncExternalStore } from 'react';
import { ConsentDecision, ConsentState, readConsent, writeConsent } from '../lib/consent';

// The visitor's analytics-consent decision, read from localStorage.
//
// The same shape as hooks/use-local-storage-flag.ts and for the same reason -
// localStorage is an external store, so it is read through the hook built for
// one - but the stakes are higher here than for a view preference, in two ways.
//
// **The banner must not flash.** Seeding useState from localStorage inside an
// effect means the first render happens before the stored decision is known, so
// a returning visitor who decided months ago sees the banner appear and then
// vanish, on every visit. useSyncExternalStore takes the server snapshot
// explicitly and reads synchronously on the client, so the very first paint
// already knows.
//
// **It must agree across tabs.** Accepting in one tab and leaving another open
// on a stale `unset` would show the banner in a tab that has already been
// answered - and, once Session 4 lands, would leave that tab's analytics off
// while the other's is on. The `storage` event covers other tabs; a local write
// notifies subscribers itself, because that event does not fire in the tab that
// caused it.

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

// Server render: nothing is stored as far as this process knows.
//
// `unset` is the honest answer and also the safe one - it is what the client
// will report for a first-time visitor, and for a returning one the client's
// first paint corrects it before anything is shown. It must never default to
// `granted`: that would render one frame of "analytics on" into the HTML for
// someone who declined.
function serverSnapshot(): ConsentState {
  return 'unset';
}

export default function useConsent(): [ConsentState, (decision: ConsentDecision) => void] {
  const state = useSyncExternalStore(subscribe, readConsent, serverSnapshot);

  const decide = useCallback((decision: ConsentDecision) => {
    writeConsent(decision);
    notify();
  }, []);

  return [state, decide];
}
