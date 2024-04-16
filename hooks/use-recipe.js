import useFetch from 'use-http'
import { useState, useEffect } from 'react';

const useRecipe = (id) => {
  let [recipe, setRecipe] = useState({ tags: [], ingredients: [] });
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getRecipe() {
    const recipe = await get(`/recipe/${id}`)
    if (response.ok) setRecipe(recipe)
  }

  useEffect(() => { getRecipe() }, [id]);

  return [recipe, setRecipe];
}

export default useRecipe;
