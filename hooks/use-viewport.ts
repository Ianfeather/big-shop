import { useSyncExternalStore } from 'react';

function subscribe(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

// window.innerWidth is an external store, so this reads it with the hook built
// for that rather than mirroring it into React state. The previous version
// subscribed in an effect and seeded the width with a setState in the effect
// body, which react-hooks/set-state-in-effect flags: every mount rendered once
// at the placeholder 320 and then again at the real width.
const useViewport = () => {
  const width = useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    // Server render: no window. 320 is the narrowest layout this app targets,
    // and was the placeholder the old version started from, so consumers that
    // branch on width degrade to the mobile layout rather than a desktop one
    // that then has to collapse.
    () => 320
  );

  return { width };
};

export default useViewport;
