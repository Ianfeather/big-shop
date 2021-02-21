import useFetch from 'use-http'
import { useState, useEffect } from 'react';

const useRecipes = () => {
  let [recipes, setRecipes] = useState([]);
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  }
  useEffect(() => { getRecipes() }, []);
  return [recipes];
};

export default useRecipes;
