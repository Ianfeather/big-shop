import { test, expect } from './fixtures';
import { createRecipe, deleteRecipeByName } from './api';
import { API_HOST } from './env';

// Recipe Search with Similar Recipes switched off, which is how every e2e run
// sees it: the stack has no TYPESAFE_API_KEY. Jev itself is covered by the Go
// tests against a stand-in (api/internal/pkg/jev); what these guard is that
// the feature is additive - off, search is exactly what it was - and that the
// route, its auth and its scoping query all work against a real database.
test.describe('recipe search', () => {
  const recipeName = `E2E Search Tagine ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  let recipeId: number;

  test.beforeAll(async ({ request }) => {
    recipeId = await createRecipe(request, { name: recipeName, method: 'Slow cook.' });
  });

  test.afterAll(async ({ request }) => {
    await deleteRecipeByName(request, recipeName);
  });

  test('finds an Exact Match, and adds nothing when Similar Recipes are off', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByPlaceholder('Search...').fill(recipeName);

    await expect(page.getByText(recipeName)).toBeVisible();
    // Past the debounce and the round trip, so an absent tranche is absent
    // rather than not-yet-arrived.
    await page.waitForResponse(res => res.url().endsWith('/recipes/similar')).catch(() => undefined);
    await expect(page.getByRole('region', { name: 'Similar recipes' })).toHaveCount(0);
  });

  test('the route answers with no matches when unconfigured', async ({ request }) => {
    // An id that is not this Account's rides along: scoping must drop it
    // silently, not fail the request.
    const res = await request.post(`${API_HOST}/recipes/similar`, {
      data: { query: 'curry', candidateIds: [recipeId, 2_000_000_000] },
    });

    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ matches: [] });
  });

  test('the route refuses a search under three characters once trimmed', async ({ request }) => {
    const res = await request.post(`${API_HOST}/recipes/similar`, {
      data: { query: '  cu  ', candidateIds: [recipeId] },
    });

    expect(res.status()).toBe(422);
  });
});
