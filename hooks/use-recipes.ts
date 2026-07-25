import useFetch, { CachePolicies } from 'use-http';
import { useState, useEffect } from 'react';
import mocks from '../mocks';
import type { RecipeSummary } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipes = () => {
  let [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const { get, response } = useFetch<RecipeSummary[]>(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: CachePolicies.NO_CACHE
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
  return [recipes] as const;
};

export default useRecipes;
