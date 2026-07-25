import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import useRecipe from '@hooks/use-recipe';
import Recipe from '@components/recipe';
import { useRouter } from 'next/router'
import styles from '../index.module.css';


const Recipes = () => {
  const router = useRouter()
  // RecipeList (below) always fetches its own recipes via useRecipes()
  // internally and has no `recipes` prop - a `recipes={...}` pass-through
  // here was dead. router.query.id is only ever a single string on this
  // route (never an array - not a catch-all route).
  const { id } = router.query as { id: string };
  const [recipe] = useRecipe(id);

  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent>
          <h1 className={styles.title}>{recipe.name}</h1>
          <Button href={`/recipes/${id}/edit`} icon="pencil" style="primary" outline={true} className={styles.topRightButton}>Edit</Button>
          <Recipe recipe={recipe} />
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
