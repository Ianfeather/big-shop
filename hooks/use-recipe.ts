import useFetch, { CachePolicies } from 'use-http';
import { useState, useEffect } from 'react';
import mocks from '../mocks';
import type { Recipe } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipe = (id: string | number) => {
  // Partial, not Recipe: until the fetch/mock lookup resolves (or if it
  // never matches), all we have is this placeholder shape.
  let [recipe, setRecipe] = useState<Partial<Recipe>>({ tags: [], ingredients: [] });
  const { get, response } = useFetch<Recipe>(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: CachePolicies.NO_CACHE
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

  return [recipe, setRecipe] as const;
}

export default useRecipe;
