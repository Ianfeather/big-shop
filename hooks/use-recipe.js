import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipe = (id) => {
  let [recipe, setRecipe] = useState({ tags: [], ingredients: [] });
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getRecipe() {
    if (useMocks) {
      const match = mocks.recipes.find(r => String(r.id) === String(id) || r.slug === id);
      if (match) setRecipe(match);
      return;
    }
    const recipe = await get(`/recipe/${id}`)
    if (response.ok) setRecipe(recipe)
  }

  useEffect(() => { getRecipe() }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return [recipe, setRecipe];
}

export default useRecipe;
