import { test, expect } from './fixtures';
import { createRecipe, deleteRecipeByName, findRecipeIdByName } from './api';

// Each test creates its own uniquely-named, throwaway Recipe and cleans up
// after itself via a direct API call (not through the UI, so cleanup doesn't
// depend on the thing under test working) - the dev DB is shared across runs
// and never reset, so nothing here can rely on starting from an empty state.
function uniqueName(label: string) {
  return `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

test.describe('recipe management', () => {
  let recipeName: string | undefined;

  test.afterEach(async ({ request }) => {
    if (!recipeName) return;
    await deleteRecipeByName(request, recipeName);
    recipeName = undefined;
  });

  test('add a recipe', async ({ page, request }) => {
    recipeName = uniqueName('Add');

    await page.goto('/recipes/new');
    await page.getByRole('button', { name: 'Enter Manually' }).click();
    await page.getByLabel('Recipe Name').fill(recipeName);
    await page.getByLabel('Method').fill('Combine everything and cook until done.');
    await page.getByRole('button', { name: 'Save Recipe' }).click();

    await expect(page).toHaveURL(/\/recipes\/\d+$/);
    await expect(page.getByRole('heading', { name: recipeName })).toBeVisible();
    await expect(page.getByText('Recipe saved')).toBeVisible();
    await expect(findRecipeIdByName(request, recipeName)).resolves.toBeTruthy();
  });

  test('edit a recipe', async ({ page, request }) => {
    recipeName = uniqueName('Edit');
    // Ingredients come from the API, not the UI's bulk-parse box - that box
    // makes a real LLM call, which is out of scope for these flows - see
    // e2e/recipe-import.spec.ts, which covers import with the route stubbed.
    const id = await createRecipe(request, {
      name: recipeName,
      method: 'Original method.',
      ingredients: [{ name: 'flour', quantity: '200', unit: 'gram' }],
    });

    await page.goto(`/recipes/${id}/edit`);

    const updatedName = `${recipeName} (updated)`;
    await page.getByLabel('Recipe Name').fill(updatedName);
    await page.getByLabel('Method').fill('Updated method.');
    await page.getByLabel('Quantity').fill('350');
    await page.getByRole('button', { name: 'Update Recipe' }).click();

    await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`));
    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible();
    await expect(page.getByText('Recipe saved')).toBeVisible();
    recipeName = updatedName; // so afterEach cleans up under the new name
  });

  test('delete a recipe', async ({ page, request }) => {
    recipeName = uniqueName('Delete');
    const id = await createRecipe(request, { name: recipeName });

    await page.goto(`/recipes/${id}/edit`);
    await page.getByRole('button', { name: 'Delete Recipe' }).click();

    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.getByRole('checkbox', { name: recipeName })).toHaveCount(0);

    recipeName = undefined; // deletion under test already cleaned this up
  });
});
