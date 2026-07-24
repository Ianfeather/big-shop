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
  // A second, always-selected recipe. pages/list.js's getShoppingList()
  // bails out without calling the API when the selection becomes empty
  // (`if (!selectedRecipes.length) return;`), so deselecting your *only*
  // recipe never actually clears its ingredients from what's displayed -
  // see follow-ups.md. Keeping a second recipe selected throughout means
  // the "remove a recipe" test exercises the realistic, common case
  // (removing one of several) rather than that edge case.
  const keepAliveIngredientName = `e2e keep-alive ingredient ${runId}`;
  const keepAliveRecipeName = `E2E Shopping List Keep-alive Recipe ${runId}`;
  let recipeId: number;
  let keepAliveRecipeId: number;

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
  });

  test.afterAll(async ({ request }) => {
    await clearShoppingList(request);
    await deleteRecipeById(request, recipeId);
    await deleteRecipeById(request, keepAliveRecipeId);
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
