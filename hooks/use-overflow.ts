import { useEffect, useRef, useState, DependencyList, RefObject } from 'react';

// Tracks whether an element's content overflows its box, so a scrollable
// row can show a fade/affordance only when there's actually more to scroll to.
export default function useOverflow<T extends Element = Element>(
  deps: DependencyList = []
): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function checkOverflow() {
      const current = ref.current;
      if (!current) return;
      setIsOverflowing(current.scrollWidth > current.clientWidth + 1);
    }

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, isOverflowing];
}
