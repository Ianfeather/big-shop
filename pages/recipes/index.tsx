import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list';
import EmptyState from '@components/empty-state';
import PageHeading from '@components/page-heading';
import OpenBookIllustration from '@components/svg/open-book';

const Recipes = () => {
  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent fullHeight={false}>
          <PageHeading subheading="View, edit and curate the recipes you cook on repeat.">
            Your Recipes
          </PageHeading>
          {/* This column has nothing else to show: the recipes themselves live
              in the rail, and picking one navigates away. Unlike the Shopping
              List's, this empty state is not conditional - it is what the page
              always looks like. */}
          <EmptyState
            illustration={OpenBookIllustration}
            illustrationLabel="An open recipe book"
            title="Nothing open yet"
          >
            Pick a recipe from the list to read, edit or delete it &mdash; or start a new
            one and it&rsquo;ll be waiting here next time.
          </EmptyState>
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
