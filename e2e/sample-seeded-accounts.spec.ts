import { test, expect } from './fixtures';
import { deleteRecipeByName } from './api';
import { API_HOST } from './env';

// The data/mechanism half of specs/completed/sample-seeded-accounts.md's
// Phase 1 - that the three production starter slugs are real, featured, and
// copyable, and that a copy correctly carries `sample: true`.
//
// **What this does not, and cannot, cover: that the seed actually fires on a
// brand-new signup.** That requires `LinkOrCreateIdentity` to take its
// "genuinely new person" branch, which needs a subject this DB has never
// seen - and under DISABLE_AUTH every request resolves to the one fixed
// `DEV_USER_ID` the whole stack is seeded with, with no per-spec override.
// specs/completed/featured-recipes.md hit the identical class of limitation
// for its own logged-out journey and was explicit about it rather than
// silent: "It cannot be tested here... coverage is lib/return-to.test.ts,
// which is the coverage rather than a supplement to it, and a manual pass."
// The equivalent here is a manual pass against a one-off container with an
// overridden DEV_USER_ID/DEV_USER_EMAIL - done once, documented in PR #193,
// not repeatable by this suite.
//
// Fixtures live in a *second* Account with no members
// (docker/mysql-seed/dev-seed.sql), mirroring e2e/featured-recipe.spec.ts's
// own reasoning: every other read of `recipe` in the Go API is scoped by
// account_id, so a featured lookup that copied that habit would be wrong in
// production and still pass a test whose caller happened to own the source.
test.describe.configure({ mode: 'serial' });

const STARTERS = [
  { slug: 'chicken-fricassee', name: 'Chicken Fricassee' },
  { slug: 'thai-green-curry', name: 'Thai Green Curry' },
  { slug: 'creamy-sausage-pasta', name: 'Creamy Sausage Pasta' },
] as const;

// Nothing here touches the Shopping List, so this file is safe to run
// alongside shopping-list.spec.ts - same reason featured-recipe.spec.ts gives.
// The ingredient-combining mechanism itself (two matching lines merging into
// one Amount) is already covered generically by shopping-list.spec.ts's "unit
// combining" suite; what's specific to this feature is the three slugs below
// being real, featured, and correctly marked as samples once copied.
test.describe('sample-seeded Account starter Recipes', () => {
  test.afterEach(async ({ request }) => {
    for (const { name } of STARTERS) {
      await deleteRecipeByName(request, name);
    }
  });

  for (const { slug, name } of STARTERS) {
    test(`${slug} is a real, featured, copyable Recipe`, async ({ page, request }) => {
      await page.goto(`/recipes/add/${slug}`);

      await expect(page).toHaveURL(/\/recipes\/\d+$/);
      await expect(page.getByRole('heading', { name })).toBeVisible();

      // Genuinely in the caller's Account, and marked as a sample - the one
      // field this feature actually adds, so the one thing worth asserting
      // on the API response rather than the page alone.
      const res = await request.get(`${API_HOST}/recipes`);
      const recipes = await res.json();
      const copy = recipes.find((r: { name: string }) => r.name === name);
      expect(copy).toBeTruthy();
      expect(copy.sample).toBe(true);
    });
  }
});
