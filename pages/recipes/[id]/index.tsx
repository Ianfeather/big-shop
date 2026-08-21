import Layout, { Grid, MainContent, Sidebar } from '@components/layout'
import RecipeList from '@components/recipe-list'
import Button from '@components/button';
import Toast from '@components/toast';
import useRecipe from '@hooks/use-recipe';
import useRecipeIdParam from '@hooks/use-recipe-id-param';
import Recipe from '@components/recipe';
import PageHeading from '@components/page-heading';
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
    // 'featured' and 'already' come from pages/recipes/add/[slug].tsx rather
    // than from Form.tsx, and they say different things: one recipe has just
    // arrived from an email link, the other was already here. The second is the
    // one worth having - arriving somewhere you did not navigate to, with no
    // explanation, reads as the link having done nothing.
    const stored = router.query.stored;
    const message = stored === 'featured' ? 'Recipe added to your collection'
      : stored === 'already' ? 'You already had this recipe'
      : stored === 'new' || stored === 'updated' ? 'Recipe saved'
      : null;
    if (message) {
      // Copied into state on purpose: the router.replace below strips the
      // param immediately, so the toast cannot be derived from the URL - it
      // would vanish on the same tick it appeared. Deriving it instead would
      // mean leaving ?stored= in the address bar, which is what this is
      // avoiding. (follow-ups.md #32)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToastMessage(message);
      router.replace(`/recipes/${id}`, undefined, { shallow: true });
    }
  }, [router.isReady, id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout
      pageTitle={"Recipes"}
      toast={toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
    >
      <Grid>
        <MainContent>
          {/* Edit was absolutely positioned into the top-right corner, which is
              where the masthead now puts it anyway - as a real sibling of the
              title rather than a box floated over the page. */}
          <PageHeading
            action={<Button href={`/recipes/${id}/edit`} icon="pencil" style="primary">Edit</Button>}
          >
            {recipe.name}
          </PageHeading>
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
