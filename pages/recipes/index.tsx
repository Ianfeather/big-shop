import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list';
import styles from './index.module.css';

const Recipes = () => {
  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent fullHeight={false}>
          <div className={styles.introHeader}>
            <h1 className={styles.introHeading}>Your Recipes</h1>
            <p className={styles.introSubheading}>View, edit and curate the recipes you cook on repeat.</p>
          </div>
        </MainContent>
        <Sidebar>
          <RecipeList />
        </Sidebar>
      </Grid>
    </Layout>
  )
}

export default Recipes
