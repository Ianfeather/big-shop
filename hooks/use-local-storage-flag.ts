import { useCallback, useSyncExternalStore } from 'react';

// A boolean view preference kept in localStorage, for the ones that belong to a
// device rather than to an Account - how *you* like the Shopping List laid out
// on the phone in your hand, not something to sync to whoever you share the
// list with.
//
// localStorage is an external store, so this reads it with the hook built for
// that (see use-page-visibility.ts for the same reasoning). It matters more
// here: the alternative is seeding useState from localStorage, which either
// reads during the server render - where there is no localStorage - or renders
// once with a guessed default and then flips. useSyncExternalStore takes the
// server snapshot explicitly, so SSR and the first client render agree and
// hydration doesn't warn.
//
// The `storage` event only fires in *other* tabs, so a local write has to
// notify subscribers itself. Without that the component that just called
// setFlag would never re-render.

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

// Reading localStorage throws in a browser with cookies/site-data blocked, and
// a view preference is never worth taking the page down for.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function useLocalStorageFlag(
  key: string,
  defaultValue: boolean
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const stored = read(key);
      return stored === null ? defaultValue : stored === 'true';
    },
    // Server render: nothing is stored yet as far as this process knows, so the
    // default is the only honest answer.
    () => defaultValue
  );

  const setValue = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Still notify: the preference won't survive a reload, but the toggle
      // has to work for the session the shopper is in.
    }
    notify();
  }, [key]);

  return [value, setValue];
}
