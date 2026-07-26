import { test, expect } from './fixtures';
import { createRecipe, deleteRecipeById, clearShoppingList } from './api';

// Under DISABLE_AUTH every request resolves to the same dev Account, so the
// Shopping List is one singleton mutable resource shared across this whole
// file - these tests run serially, in a fixed order, deliberately carrying
// list state from one to the next (mirroring a real shopping trip), rather
// than each being independent. beforeAll/afterAll bracket the suite with a
// clear so it's correct regardless of what a previous run left behind.
test.describe.configure({ mode: 'serial' });

test.describe('shopping list', () => {
  const runId = Date.now();
  const ingredientName = `e2e ingredient ${runId}`;
  const extraName = `e2e extra ${runId}`;
  const recipeName = `E2E Shopping List Recipe ${runId}`;
  // A second recipe, kept selected throughout the "remove a recipe" test so
  // that one exercises the realistic, common case (removing one of several).
  // The zero-recipes-selected edge case (previously buggy - see follow-ups.md
  // #14) gets its own dedicated test below, run first while the list is empty.
  const keepAliveIngredientName = `e2e keep-alive ingredient ${runId}`;
  const keepAliveRecipeName = `E2E Shopping List Keep-alive Recipe ${runId}`;
  const soloIngredientName = `e2e solo ingredient ${runId}`;
  const soloRecipeName = `E2E Shopping List Solo Recipe ${runId}`;
  let recipeId: number;
  let keepAliveRecipeId: number;
  let soloRecipeId: number;

  test.beforeAll(async ({ request }) => {
    await clearShoppingList(request);
    recipeId = await createRecipe(request, {
      name: recipeName,
      ingredients: [{ name: ingredientName, quantity: '200', unit: 'gram' }],
    });
    keepAliveRecipeId = await createRecipe(request, {
      name: keepAliveRecipeName,
      ingredients: [{ name: keepAliveIngredientName, quantity: '1', unit: 'unit' }],
    });
    soloRecipeId = await createRecipe(request, {
      name: soloRecipeName,
      ingredients: [{ name: soloIngredientName, quantity: '1', unit: 'unit' }],
    });
  });

  test.afterAll(async ({ request }) => {
    await clearShoppingList(request);
    await deleteRecipeById(request, recipeId);
    await deleteRecipeById(request, keepAliveRecipeId);
    await deleteRecipeById(request, soloRecipeId);
  });

  test('deselecting your only selected recipe clears its ingredients', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('checkbox', { name: soloRecipeName }).click({ force: true });
    await expect(page.getByRole('checkbox', { name: soloIngredientName })).toBeVisible();

    await page.getByRole('checkbox', { name: soloRecipeName }).click({ force: true });
    await expect(page.getByRole('checkbox', { name: soloIngredientName })).toHaveCount(0);
  });

  test('add a recipe to the shopping list', async ({ page }) => {
    await page.goto('/list');
    // The recipe checkbox is deliberately `pointer-events: none` (visually
    // hidden, toggled via its wrapping <label>) - force lands the click on
    // the label underneath, which is how a sighted mouse user actually
    // interacts with it too.
    await page.getByRole('checkbox', { name: recipeName }).click({ force: true });
    await expect(page.getByRole('checkbox', { name: ingredientName })).toBeVisible();
  });

  test('add an extra ingredient', async ({ page }) => {
    await page.goto('/list');
    await page.getByPlaceholder('beer, snacks...').fill(extraName);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('checkbox', { name: extraName })).toBeVisible();
  });

  test('mark an item as bought', async ({ page }) => {
    await page.goto('/list');
    const item = page.getByRole('checkbox', { name: ingredientName });
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('heading', { name: 'Already bought' })).toBeVisible();
  });

  test('un-mark a bought item', async ({ page }) => {
    await page.goto('/list');
    const item = page.getByRole('checkbox', { name: ingredientName });
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', 'false');
  });

  test('remove a recipe from the shopping list', async ({ page }) => {
    await page.goto('/list');
    // Keep a second recipe selected so the list isn't left empty by this
    // removal - see the keep-alive comment above.
    await page.getByRole('checkbox', { name: keepAliveRecipeName }).click({ force: true });
    await page.getByRole('checkbox', { name: recipeName }).click({ force: true });

    await expect(page.getByRole('checkbox', { name: ingredientName })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: keepAliveIngredientName })).toBeVisible();
  });

  test('clear the list', async ({ page }) => {
    await page.goto('/list');
    // The extra ingredient added earlier is still on the list - the recipe
    // was removed above, but nothing has cleared extras yet.
    await expect(page.getByRole('checkbox', { name: extraName })).toBeVisible();

    await page.getByRole('button', { name: 'Clear list and start over' }).click();
    await page.getByRole('button', { name: 'You sure? Click to confirm' }).click();

    await expect(page.getByText('Your shopping list is empty')).toBeVisible();
  });
});

// This is the case Vitest can't reach: combining happens in the Go service
// against the real unit table, so only a round trip through the actual API
// proves the units were classified, loaded and converted correctly.
//
// A separate describe purely so it gets its own fixtures and lifecycle - not
// because it behaves differently from the suite above. Like that one it is
// serial and carries state deliberately: the recipe selection made by the
// first test is what the other two then assert against. Serial mode is
// inherited from the file-scope configure above (Playwright rejects assigning
// it twice in one scope), and `fullyParallel: true` in playwright.config.ts
// means losing it would silently break the two dependent tests.
test.describe('shopping list unit combining', () => {
  const runId = Date.now();
  const mergeable = `e2e mergeable ${runId}`;
  const unmergeable = `e2e unmergeable ${runId}`;
  const spoonsRecipeName = `E2E Spoons Recipe ${runId}`;
  const gramsRecipeName = `E2E Grams Recipe ${runId}`;
  let spoonsRecipeId: number;
  let gramsRecipeId: number;

  test.beforeAll(async ({ request }) => {
    await clearShoppingList(request);
    spoonsRecipeId = await createRecipe(request, {
      name: spoonsRecipeName,
      ingredients: [
        { name: mergeable, quantity: '2', unit: 'tablespoon' },
        { name: unmergeable, quantity: '1', unit: 'packet' },
      ],
    });
    gramsRecipeId = await createRecipe(request, {
      name: gramsRecipeName,
      ingredients: [
        { name: mergeable, quantity: '2', unit: 'teaspoon' },
        { name: unmergeable, quantity: '200', unit: 'gram' },
      ],
    });
  });

  test.afterAll(async ({ request }) => {
    await clearShoppingList(request);
    // Note: these deletes currently fail silently for any recipe that reached
    // the shopping list - see follow-ups.md #24. Harmless here because the e2e
    // database is recreated per run, and deleteRecipeById doesn't assert.
    await deleteRecipeById(request, spoonsRecipeId);
    await deleteRecipeById(request, gramsRecipeId);
  });

  test('combines Absolute Units of the same kind into one amount', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('checkbox', { name: spoonsRecipeName }).click({ force: true });
    await page.getByRole('checkbox', { name: gramsRecipeName }).click({ force: true });

    // 2 tablespoon (30ml) + 2 teaspoon (10ml). Before unit-aware aggregation
    // these were summed to a bare "4" under whichever unit was seen first.
    await expect(page.getByRole('checkbox', { name: mergeable })).toContainText('40 millilitre');
  });

  test('keeps units it cannot convert as separate amounts on one line', async ({ page }) => {
    await page.goto('/list');

    // A packet's size depends on the ingredient, so there is no honest
    // conversion to grams yet - both amounts stay, on a single checkbox.
    const item = page.getByRole('checkbox', { name: unmergeable });
    await expect(item).toContainText('200 gram');
    await expect(item).toContainText('1 packet');
    await expect(page.getByRole('checkbox', { name: unmergeable })).toHaveCount(1);
  });

  test('marks every amount of an item bought from one click', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('checkbox', { name: unmergeable }).click();

    const bought = page.locator('h2', { hasText: 'Already bought' })
      .locator('..')
      .getByRole('checkbox', { name: unmergeable });
    await expect(bought).toHaveAttribute('aria-checked', 'true');
    await expect(bought).toContainText('200 gram');
    await expect(bought).toContainText('1 packet');
  });
});
