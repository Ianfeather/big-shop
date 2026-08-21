import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout, { Grid, MainContent } from '@components/layout';
import PageHeading from '@components/page-heading';
import EmptyState from '@components/empty-state';
import OpenBookIllustration from '@components/svg/open-book';
import useAuth from '@hooks/use-auth';
import { apiPost, ApiError } from '../../../lib/api-client';
import { recipeImported } from '../../../lib/analytics/events';

// Where the Day 8 onboarding email's Featured Recipe links land.
//
// The whole page is a redirect with a waiting room: it copies the Featured
// Recipe into your Account and then replaces itself with your copy. There is
// deliberately no preview and no confirm step - see specs/completed/featured-recipes.md.
// An unwanted Recipe is one delete away, and the Recipe page it lands on is
// already the structured view that makes the case for the product better than
// this page could.
//
// It never touches the Shopping List. That is the sharpest decision behind the
// feature: the List is one mutable resource shared by the whole Account, the
// email arrives at 10:00 local, and a link tapped over coffee must not change
// what somebody else is holding in the shop.
//
// **The interesting state is the third one.** A slug with no published Recipe
// behind it is expected rather than exceptional: the email template's slugs are
// hand-picked in the repo while the flag lives in the production database, and
// ADR-0011 accepts that the two can drift with nothing in CI able to catch it.
// This page is that decision's mitigation, so the "not available" state is a
// real page rather than a 500 or a silent bounce.

type State = 'adding' | 'missing' | 'failed';

const AddFeaturedRecipe = () => {
  const router = useRouter();
  const { getAccessTokenSilently } = useAuth();
  const [state, setState] = useState<State>('adding');
  // The add is a write triggered by arriving, so it must happen exactly once.
  // reactStrictMode double-invokes effects in development, and `slug` also
  // settles across renders as the router becomes ready - either would otherwise
  // copy the Recipe twice. The server's already-taken check makes that harmless
  // rather than duplicating, but relying on the server to undo a bug the client
  // caused is not the same as not having it.
  const started = useRef(false);

  useEffect(() => {
    if (!router.isReady || started.current) return;
    started.current = true;

    (async () => {
      // A [slug] route cannot match without a slug segment, so this is
      // defensive rather than reachable - but it is checked inside the async
      // body, not above it, so the page has one place that decides what
      // happened rather than two.
      const slug = router.query.slug;
      if (typeof slug !== 'string' || slug === '') {
        setState('missing');
        return;
      }

      try {
        const token = await getAccessTokenSilently();
        const result = await apiPost<{ id: number; alreadyHad: boolean }>(
          `/recipe/featured/${encodeURIComponent(slug)}`, token
        );

        // Counted on the copy succeeding, matching how every other Source is
        // counted - an import that failed never became a Recipe, and counting
        // it would report an arrival rate the collection does not show. The
        // parameter is one word from a closed set; no slug, no name, no id.
        if (!result.alreadyHad) {
          recipeImported('featured');
        }

        // The existing one-time toast convention (ADR-0003), reused rather than
        // reinvented. `already` exists because landing on a Recipe you own with
        // no explanation reads as the link having done nothing.
        router.replace(`/recipes/${result.id}?stored=${result.alreadyHad ? 'already' : 'featured'}`);
      } catch (err) {
        setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'failed');
      }
    })();
  }, [router.isReady, router.query.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout pageTitle="Recipes">
      <Grid>
        <MainContent fullHeight={false}>
          { state === 'adding' && (
            <PageHeading subheading="One moment while we put it in your collection.">
              Adding the recipe
            </PageHeading>
          )}

          { state !== 'adding' && (
            <>
              <PageHeading subheading={
                state === 'missing'
                  ? 'This one isn’t available any more.'
                  : 'Something went wrong adding it.'
              }>
                {state === 'missing' ? 'Recipe not available' : 'Couldn’t add the recipe'}
              </PageHeading>
              <EmptyState
                illustration={OpenBookIllustration}
                illustrationLabel="An open recipe book"
                title={state === 'missing' ? 'Nothing to add' : 'Nothing added'}
              >
                { state === 'missing'
                  ? <>The recipe behind this link isn’t being shared any longer. Nothing has changed
                      in your collection &mdash; have a look at <Link href="/recipes">your recipes</Link>,
                      or <Link href="/recipes/new">add one of your own</Link>.</>
                  : <>Nothing has changed in your collection. Try the link again, or head to <Link href="/recipes">your recipes</Link>.</>
                }
              </EmptyState>
            </>
          )}
        </MainContent>
      </Grid>
    </Layout>
  );
};

export default AddFeaturedRecipe;
