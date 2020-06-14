import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Link from 'next/link'
import Layout from '@components/layout'

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
      <section>
        <div className={styles.grid}>
          <div>
            <h2>Recipes</h2>
            <ul>
              {
                recipes.map(({id, name}) => {
                  return (
                    <li key={id}>
                      <Link href={`/recipe/edit?recipe=${id}`}>
                        <a>{name}</a>
                      </Link>
                    </li>
                  );
                })
              }
              <li>
                <Link href={`/recipe/new`}>
                  <a>Add new recipe</a>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
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
