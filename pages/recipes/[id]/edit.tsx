import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import useRecipe from '@hooks/use-recipe';
import useRecipeIdParam from '@hooks/use-recipe-id-param';
import Form from '@components/recipe-form/Form';
import PageHeading from '@components/page-heading';
import { useRouter } from 'next/router';


const Recipes = () => {
  // RecipeList (below) always fetches its own recipes via useRecipes()
  // internally and has no `recipes` prop - a `recipes={...}` pass-through
  // here was dead.
  const id = useRecipeIdParam();
  const [recipe] = useRecipe(id);
  const router = useRouter();

  // ?add=method is how the pencil beside an empty Method section on the Recipe
  // page arrives here (components/recipe/index.tsx). It scrolls the form to the
  // Method and opens Method Import, so the click lands on the thing it was
  // about rather than at the top of a form. Anything else is ignored - it is a
  // hint about where to look, not something to fail on.
  const focusSection = router.query.add === 'method' ? 'method' as const : undefined;

  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent>
          <PageHeading
            action={<Button href={`/recipes/${id}`} icon="back" style="primary">Cancel edits</Button>}
          >
            {recipe.name}
          </PageHeading>
          <Form initialRecipe={recipe} mode="edit" focusSection={focusSection} />
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
