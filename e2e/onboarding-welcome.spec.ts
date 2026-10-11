import { test, expect } from './fixtures';

// specs/onboarding.md Stage 2's Archive CTA: a single link straight into
// Photo Import, skipping the tab picker rather than landing on it and
// requiring one more click. Nothing here touches the Shopping List, so this
// file needs no serial mode and is safe alongside shopping-list.spec.ts.
//
// What this deliberately does not cover: the welcome itself appearing on
// /list. Under DISABLE_AUTH every e2e request resolves to the one fixture
// Account dev-seed.sql gives two real Recipes from the start, so
// `ownRecipeCount` is never 0 here - the same class of limitation
// specs/completed/featured-recipes.md documented for its own logged-out
// journey, and specs/completed/sample-seeded-accounts.md's PR for the
// seed-on-signup integration: there is no way, under this harness, to
// represent "a brand-new Account" against a fixture Account that is
// permanently not one. Covered by a manual pass instead - see PR evidence.
test.describe('the onboarding welcome’s Archive CTA', () => {
  test('?source=camera lands straight on Photo Import, not the tab picker', async ({ page }) => {
    await page.goto('/recipes/new?source=camera');

    await expect(page.getByRole('button', { name: 'Take or upload a photo' })).toBeVisible();
  });

  test('visiting /recipes/new with no source still defaults to the URL tab', async ({ page }) => {
    await page.goto('/recipes/new');

    await expect(page.getByLabel('Recipe URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take or upload a photo' })).not.toBeVisible();
  });
});
