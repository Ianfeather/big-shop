import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list';
import useViewport from '@hooks/use-viewport';
import Link from 'next/link';

const Recipes = () => {
  const { width } = useViewport();

  if (width < 800) {
    return (
      <Layout pageTitle={"Recipes"}>
        <MainContent>
          <RecipeList />
        </MainContent>
      </Layout>
    )
  }

  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent>
          <div>Here you can view, edit and curate your list of recipes</div>
          <Link href="/recipes/new">Add new recipe</Link>
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
