import { useEffect, useRef, useState } from 'react';

// Tracks whether an element's content overflows its box, so a scrollable
// row can show a fade/affordance only when there's actually more to scroll to.
export default function useOverflow(deps = []) {
  const ref = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function checkOverflow() {
      setIsOverflowing(el.scrollWidth > el.clientWidth + 1);
    }

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, isOverflowing];
}
