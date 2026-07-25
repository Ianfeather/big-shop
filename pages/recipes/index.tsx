import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list';
import Button from '@components/button';
import styles from './index.module.css';

const Recipes = () => {
  return (
    <Layout pageTitle={"Recipes"}>
      <Grid>
        <MainContent fullHeight={false}>
          <div className={styles.introHeader}>
            <div>
              <h1 className={styles.introHeading}>Your Recipes</h1>
              <p className={styles.introSubheading}>View, edit and curate the recipes you cook on repeat.</p>
            </div>
            <Button href="/recipes/new" style="primary" icon="tick" className={styles.introButton}>Add new recipe</Button>
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
