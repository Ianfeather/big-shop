import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'
import RecipeList from '@components/recipe-list'
import SingleColumnLayout from '@components/layout/single-column';

const Recipes = ({ title, description, ...props }) => {
  let [recipes, setRecipes] = useState([
  {
    "name": "Shepherds Pie",
    "id": 1,
    "remoteUrl": ""
  },
  {
    "name": "Spaghetti Bolognese",
    "id": 2,
    "remoteUrl": ""
  },
  {
    "name": "Pea and Pancetta Risotto",
    "id": 3,
    "remoteUrl": ""
  },
  {
    "name": "Chilli Con Carne",
    "id": 4,
    "remoteUrl": ""
  },
  {
    "name": "Kotlety",
    "id": 5,
    "remoteUrl": ""
  },
  {
    "name": "Sausage and Mash",
    "id": 6,
    "remoteUrl": ""
  },
  {
    "name": "Fish Pie",
    "id": 7,
    "remoteUrl": ""
  },
  {
    "name": "Pork and Chorizo Burgers",
    "id": 8,
    "remoteUrl": ""
  }
]);

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
