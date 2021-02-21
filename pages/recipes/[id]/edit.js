import { useState } from 'react';
import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import useRecipe from '@hooks/use-recipe';
import Form from '@components/recipe-form/Form';
import Recipe from '@components/recipe';
import useRecipes from '@hooks/use-recipes';
import { useRouter } from 'next/router';
import styles from '../index.module.css';


const Recipes = () => {
  const router = useRouter()
  const { id } = router.query
  const [recipe] = useRecipe(id);
  const [recipes] = useRecipes();

  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent>
          <h1 className={styles.title}>{recipe.name}</h1>
          <Form initialRecipe={recipe} mode="edit" />:
        </MainContent>
        <Sidebar>
          <RecipeList recipes={recipes} />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
