import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipes = () => {
  let [recipes, setRecipes] = useState([]);
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    let cancelled = false;

    async function getRecipes() {
      if (useMocks) {
        if (!cancelled) setRecipes(mocks.recipes.map(({ id, name, tags }) => ({ id, name, tags })));
        return;
      }
      const recipes = await get('/recipes')
      if (!cancelled && response.ok) setRecipes(recipes)
    }
    getRecipes();

    // React 18 Strict Mode double-invokes effects in dev (mount, cleanup,
    // mount again). Without this guard, the throwaway first call can resolve
    // after the real one and stomp good data with an aborted/empty result.
    return () => { cancelled = true };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [recipes];
};

export default useRecipes;
