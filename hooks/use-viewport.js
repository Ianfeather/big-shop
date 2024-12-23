import { useState, useEffect } from 'react';

const useViewport = () => {
  const [width, setWidth] = useState(320);

  useEffect(() => {
    setWidth(window.innerWidth);
    const handleWindowResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);
  return { width };
}

export default useViewport;
