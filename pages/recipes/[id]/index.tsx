import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import Toast from '@components/toast';
import useRecipe from '@hooks/use-recipe';
import useRecipeIdParam from '@hooks/use-recipe-id-param';
import Recipe from '@components/recipe';
import styles from '../index.module.css';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';


const Recipes = () => {
  // RecipeList (below) always fetches its own recipes via useRecipes()
  // internally and has no `recipes` prop - a `recipes={...}` pass-through
  // here was dead.
  const id = useRecipeIdParam();
  const [recipe] = useRecipe(id);
  const router = useRouter();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form.tsx redirects here with a one-time ?stored=new|updated after a
  // successful create/edit (see ADR-0003) - read it once, then strip it via
  // router.replace so a reload/back-nav/shared link doesn't re-show the toast.
  useEffect(() => {
    if (!router.isReady || !id) return;
    if (router.query.stored === 'new' || router.query.stored === 'updated') {
      setToastMessage('Recipe saved');
      router.replace(`/recipes/${id}`, undefined, { shallow: true });
    }
  }, [router.isReady, id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout pageTitle={"Recipes"}>
      { toastMessage && (
        // Rendered as a sibling above Grid, not inside MainContent: MainContent
        // is `position: relative` and the Edit button below is positioned
        // absolutely against it, so a Toast inside would shift the heading
        // down without moving Edit, overlapping the two.
        <div className={styles.toastWrapper}>
          <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        </div>
      )}
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
