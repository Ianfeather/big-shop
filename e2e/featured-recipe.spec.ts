import { test, expect } from './fixtures';
import { deleteRecipeByName, findRecipeIdByName } from './api';

// The Day 8 onboarding email's link, end to end: arriving at
// /recipes/add/<slug> puts a Featured Recipe in your Account and lands you on
// your copy.
//
// The fixture is seeded rather than created here, and it lives in a *second*
// Account with no members (docker/mysql-seed/dev-seed.sql). That is the point
// of it: every other read of `recipe` in the Go API is scoped by account_id, so
// a featured lookup that copied that habit would be wrong in production and
// still pass a test whose caller happened to own the source. Here the caller
// does not own it, so it fails.
// **Serial, like shopping-list.spec.ts and for the same reason.**
// playwright.config.ts sets `fullyParallel: true`, so without this the four
// tests below run at once - and under DISABLE_AUTH they all share one Account,
// which means one copy of this Featured Recipe between them. They then fight:
// one test's afterEach deletes the copy another is still reading, and two
// simultaneous arrivals race the already-taken check.
//
// That race is real and is now closed in the schema
// (uniq_recipe_account_featured_from, added in migration 042 because of it) -
// but a Recipe deleted out from under a test that is looking at it is not a
// bug in the product, it is these tests standing on each other.
test.describe.configure({ mode: 'serial' });

const FEATURED_SLUG = 'store-cupboard-tomato-pasta';
const FEATURED_NAME = 'Store Cupboard Tomato Pasta';

// **Nothing here touches the Shopping List**, so this file is safe to run
// alongside shopping-list.spec.ts - Playwright runs spec files in parallel, and
// under DISABLE_AUTH the list is one mutable resource shared by the whole
// account. It has no reason to: the feature deliberately does not put anything
// on the list, which is the sharpest decision in specs/completed/featured-recipes.md.
test.describe('adding a Featured Recipe from a link', () => {
  // The copy is a real Recipe in the shared dev account and the DB is only
  // wiped between runs, not between tests.
  test.afterEach(async ({ request }) => {
    await deleteRecipeByName(request, FEATURED_NAME);
  });

  test('the link copies the recipe into your account', async ({ page, request }) => {
    await page.goto(`/recipes/add/${FEATURED_SLUG}`);

    // Lands on the copy, not on the page it started from.
    await expect(page).toHaveURL(/\/recipes\/\d+$/);
    await expect(page.getByRole('heading', { name: FEATURED_NAME })).toBeVisible();
    await expect(page.getByText('Recipe added to your collection')).toBeVisible();

    // The Ingredient Lines came with it - a copy that arrived as a bare name
    // would look identical on the heading alone.
    await expect(page.getByText('Chopped Tomatoes')).toBeVisible();
    // `exact` because the recipe rail also lists 'Spaghetti Bolognese'.
    await expect(page.getByText('Spaghetti', { exact: true })).toBeVisible();

    // And it is genuinely in the caller's Account, not merely rendered.
    await expect(findRecipeIdByName(request, FEATURED_NAME)).resolves.toBeTruthy();
  });

  // The same link is tapped on a phone at breakfast and a laptop later. A
  // second copy appearing would read as a bug, so the second arrival returns
  // the first copy and says so rather than saying nothing.
  test('a second visit returns the same recipe rather than duplicating it', async ({ page }) => {
    await page.goto(`/recipes/add/${FEATURED_SLUG}`);
    await expect(page).toHaveURL(/\/recipes\/\d+$/);
    const firstUrl = page.url();

    await page.goto(`/recipes/add/${FEATURED_SLUG}`);

    await expect(page).toHaveURL(firstUrl);
    await expect(page.getByText('You already had this recipe')).toBeVisible();
  });

  // ADR-0011 accepts that the email template's hand-picked slugs can drift from
  // the flag in the database, with nothing in CI able to compare them. This is
  // that decision's mitigation, so it is an asserted state rather than an
  // incidental one.
  test('a slug that is not published gets a real page, not an error', async ({ page }) => {
    await page.goto('/recipes/add/no-such-featured-recipe');

    await expect(page.getByRole('heading', { name: 'Recipe not available' })).toBeVisible();
    await expect(page.getByText(/nothing has changed in your collection/i)).toBeVisible();
    // `exact` because the nav carries its own 'Your Recipes' link.
    await expect(page.getByRole('link', { name: 'your recipes', exact: true })).toBeVisible();
  });

  // Resolution is by the flag, never by the identifier. `veggie-chilli` is
  // seeded in the caller's *own* Account and is not Featured, so a lookup that
  // forgot the flag would happily copy it and this would pass silently.
  test('a recipe you own but that is not featured is not addable by link', async ({ page }) => {
    await page.goto('/recipes/add/veggie-chilli');

    await expect(page.getByRole('heading', { name: 'Recipe not available' })).toBeVisible();
  });
});
