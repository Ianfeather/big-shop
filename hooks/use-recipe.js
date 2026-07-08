import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipe = (id) => {
  let [recipe, setRecipe] = useState({ tags: [], ingredients: [] });
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    let cancelled = false;

    async function getRecipe() {
      if (useMocks) {
        const match = mocks.recipes.find(r => String(r.id) === String(id) || r.slug === id);
        if (!cancelled && match) setRecipe(match);
        return;
      }
      const recipe = await get(`/recipe/${id}`)
      if (!cancelled && response.ok) setRecipe(recipe)
    }
    getRecipe();

    // React 18 Strict Mode double-invokes effects in dev (mount, cleanup,
    // mount again). Without this guard, the throwaway first call can resolve
    // after the real one and stomp good data with an aborted/empty result.
    return () => { cancelled = true };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return [recipe, setRecipe];
}

export default useRecipe;
