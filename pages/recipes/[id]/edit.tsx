import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import useRecipe from '@hooks/use-recipe';
import useRecipeIdParam from '@hooks/use-recipe-id-param';
import Form from '@components/recipe-form/Form';
import PageHeading from '@components/page-heading';


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
          <PageHeading
            action={<Button href={`/recipes/${id}`} icon="back" style="primary">Cancel edits</Button>}
          >
            {recipe.name}
          </PageHeading>
          <Form initialRecipe={recipe} mode="edit" />
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
