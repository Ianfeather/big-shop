import { useEffect, useRef } from 'react';
import useLocalStorageFlag from './use-local-storage-flag';

// A boolean preference stored on the server but painted from localStorage.
//
// The two-layer arrangement exists to get both halves of what a preference
// should do:
//
//   - **No flip on first paint.** localStorage is synchronous, so the very
//     first render already shows what you chose last time. A server-only
//     preference cannot do this: the page has to paint *something* before the
//     request resolves, so anyone whose preference differs from the default
//     watches it flip, on every visit, forever.
//   - **It follows you between devices.** localStorage alone cannot do this.
//
// So localStorage is a **cache**, not a second source of truth. The server value
// wins whenever it arrives and disagrees, and is written back to the cache so
// the next paint is right. That ordering is what keeps the two from fighting:
// there is no "which one is newer" question to answer, because the cache never
// claims to be authoritative.
//
// A flip is therefore still possible, but only when the value genuinely changed
// somewhere else - you toggled it on your phone, and now the laptop catches up.
// That is the sync working, not the problem this avoids.
//
// `remoteValue` is undefined until the server answers (or forever, if it never
// does - see use-user.ts's 404 case), and while it is, the cached value stands
// on its own.
export default function useSyncedFlag(
  key: string,
  defaultValue: boolean,
  remoteValue: boolean | undefined,
  save: (value: boolean) => void
): [boolean, (value: boolean) => void] {
  const [cached, setCached] = useLocalStorageFlag(key, defaultValue);
  const lastAdopted = useRef<boolean | undefined>(undefined);

  // Genuinely "an external system changed, mirror it" - the case the codebase
  // already treats as a legitimate effect (see pages/recipes/new.tsx's job
  // polling).
  //
  // The guard is on the *server* value changing, not on it merely differing
  // from the cache, and that distinction is load-bearing. Between the click and
  // the save resolving, the cache is deliberately ahead of the server: reacting
  // to "these differ" makes the effect revert the toggle the instant you press
  // it, then flip it back when the response lands. That bug shipped in the
  // first version of this hook and only surfaced under e2e, because whether you
  // see it depends on a race with the request.
  //
  // Adopting only on change gets both cases right: a value the server has
  // already told us about is not news, while one that genuinely changed
  // elsewhere still wins.
  useEffect(() => {
    if (remoteValue === undefined || lastAdopted.current === remoteValue) return;
    lastAdopted.current = remoteValue;
    setCached(remoteValue);
  }, [remoteValue, setCached]);

  function setValue(next: boolean) {
    // Cache first so the UI responds on the click rather than on the response,
    // then tell the server. A failed save leaves the cache ahead of the server
    // until the next load corrects it, which for a view preference is a better
    // outcome than a toggle that doesn't move.
    setCached(next);
    save(next);
  }

  return [cached, setValue];
}
