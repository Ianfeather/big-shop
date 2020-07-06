import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'
import RecipeList from '@components/recipe-list'
import SingleColumnLayout from '@components/layout/single-column';

const Recipes = ({ title, description, ...props }) => {
  let [recipes, setRecipes] = useState([]);

  const { get, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  };

  useEffect(() => { getRecipes() }, []);

  return (
    <Layout pageTitle={title} description={description}>
      <SingleColumnLayout>
        <h2>Recipes</h2>
        <RecipeList recipes={recipes} />
      </SingleColumnLayout>
    </Layout>
  )
}

export default Recipes

export async function getStaticProps() {
  const configData = (await import(`../siteconfig.json`)).default;

  return {
    props: {
      title: "Recipes",
      description: configData.description,
    },
  }
}
