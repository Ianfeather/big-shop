import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list';
import Link from 'next/link';

const Recipes = () => {
  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent>
          <div>Here you can view, edit and curate your list of recipes</div>
          <Link href="/recipes/new"><a>Add new recipe</a></Link>
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
