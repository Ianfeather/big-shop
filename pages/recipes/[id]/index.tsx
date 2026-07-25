import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import useRecipe from '@hooks/use-recipe';
import useRecipeIdParam from '@hooks/use-recipe-id-param';
import Recipe from '@components/recipe';
import styles from '../index.module.css';


const Recipes = () => {
  // RecipeList (below) always fetches its own recipes via useRecipes()
  // internally and has no `recipes` prop - a `recipes={...}` pass-through
  // here was dead.
  const id = useRecipeIdParam();
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
