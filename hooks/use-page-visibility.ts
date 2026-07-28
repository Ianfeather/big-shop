import { useSyncExternalStore } from 'react';

function subscribe(onStoreChange: () => void) {
  document.addEventListener('visibilitychange', onStoreChange);
  return () => document.removeEventListener('visibilitychange', onStoreChange);
}

// document.visibilityState is an external store, so this reads it with the
// hook built for that rather than mirroring it into React state. The previous
// version subscribed in an effect and seeded the initial value with a
// setState in the effect body, which react-hooks/set-state-in-effect flags:
// it renders once with a guessed value and then immediately again with the
// real one. useSyncExternalStore has the real value on the very first render.
function usePageVisibility(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    // Server render: no document, and "visible" is the sane assumption - it
    // matches what the client will almost always resolve to, so hydration
    // does not flip.
    () => true
  );
}

export default usePageVisibility;
