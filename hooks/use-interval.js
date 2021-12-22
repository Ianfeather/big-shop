import { useState, useEffect, useRef } from 'react';
import { usePageVisibility } from 'react-page-visibility';

function useInterval(callback, delay, pauseOnHide = true) {
  const savedCallback = useRef();
  const isVisible = usePageVisibility()

  // Remember the latest callback.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval.
  useEffect(() => {
    // Don't run it in background tabs
    if (pauseOnHide && !isVisible) return;

    function tick() {
      savedCallback.current();
    }
    if (delay !== null) {
      let id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay, pauseOnHide, isVisible]);
}

export default useInterval;
