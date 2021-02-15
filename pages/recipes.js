import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'
import RecipeList from '@components/recipe-list'
import SingleColumnLayout from '@components/layout/single-column';

const Recipes = () => {
  let [recipes, setRecipes] = useState([]);

  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  }

  useEffect(() => { getRecipes() }, []);

  return (
    <Layout pageTitle={"Recipes"}>
      <SingleColumnLayout>
        <h2>Recipes</h2>
        <RecipeList recipes={recipes} />
      </SingleColumnLayout>
    </Layout>
  )
}

export default Recipes
