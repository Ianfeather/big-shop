import { useState, useEffect } from 'react';

function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Update the visibility state when the page becomes visible/hidden
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    // Set initial visibility state
    setIsVisible(!document.hidden);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clean up
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

export default usePageVisibility;
