import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const useRecipes = () => {
  let [recipes, setRecipes] = useState([]);
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getRecipes() {
    if (useMocks) {
      setRecipes(mocks.recipes.map(({ id, name, tags }) => ({ id, name, tags })));
      return;
    }
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  }
  useEffect(() => { getRecipes() }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [recipes];
};

export default useRecipes;
