import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { createRecipe, deleteRecipeById, deleteRecipeByName } from './api';
import { API_HOST } from './env';

// Recipe Import, with the LLM stubbed out at the Next.js API route.
//
// Import was previously excluded from e2e because it "makes a real LLM call"
// (see the top of recipe.spec.ts). That is true of the route's *internals* and
// beside the point: intercepting the route and returning canned JSON exercises
// every line between the extractor and the database without a model being
// involved at all - and that is where the bugs have actually been.
//
// Two real defects in specs/completed/unit-normalisation.md's Phase 4 lived in
// exactly this path and no test caught either. The important one: the catalog
// metadata the extractor proposes for a brand-new ingredient (its Base Unit,
// Display Unit and Unit Sizes) was silently dropped by URL and Photo import,
// because those reach the form through `initialRecipe` while the paste box
// goes through `appendIngredients`. Pure plumbing, spread across three files
// and two languages, with every individual piece correct.
//
// Which is why all three Import Sources are covered here rather than one: two
// distinct code paths, and the bug was present in two of the three, so a test
// covering only the paste box would have passed while the rest was broken.
test.describe.configure({ mode: 'serial' });

const runId = Date.now();

// A name nothing in the catalog can match, so the server treats it as new and
// classification actually applies. An ingredient that already exists is
// deliberately left alone (see classifyNewIngredients).
const novel = (source: string) => `e2e novel ${source} ${runId}`;

function parsedRecipe(name: string, ingredientName: string) {
  return {
    name,
    method: 'Combine everything and cook until done.',
    tags: [],
    ingredients: [
      {
        name: ingredientName,
        quantity: '2',
        unit: '',
        // The fields under test. One of these is worth 150 grams, so two of
        // them plus a 300g line should combine into 600g - which is the only
        // way to observe from outside that they survived the journey.
        baseUnit: 'gram',
        unitSizes: { '': 150 },
      },
    ],
  };
}

// Captures the body of the save request the page makes, so a test can assert
// what actually left the browser.
//
// Deliberately not asserted via the Shopping List, though that is the more
// end-to-end signal. The list is a single mutable resource shared by the whole
// account under DISABLE_AUTH, and Playwright runs spec *files* in parallel -
// shopping-list.spec.ts guards itself with serial mode within its own file, but
// nothing stops another file stomping it. An earlier version of this spec did
// exactly that and made an unrelated test time out.
//
// The boundary is honest about what it covers: this proves the classification
// survives extraction, the form and the save payload - the JS plumbing where
// both Phase 4 bugs actually were. What the server then does with it is covered
// by service.TestClassifyNewIngredients.
function captureSavePayload(page: Page) {
  const payloads: any[] = [];
  page.on('request', (request) => {
    // Built from API_HOST rather than a hardcoded suffix. This used to match
    // `endsWith('/recipes/recipe')`, which only worked because the API's base
    // path happened to end in `recipes` - changing it to /api/bigshop made this
    // capture silently stop firing, and the test failed on "no save request was
    // made" rather than on anything to do with the payload.
    if (request.method() === 'POST' && request.url() === `${API_HOST}/recipe`) {
      try {
        payloads.push(request.postDataJSON());
      } catch {
        // Not JSON; not the request we're after.
      }
    }
  });
  return payloads;
}

function expectClassificationInPayload(payloads: any[], ingredientName: string) {
  const saved = payloads.at(-1);
  expect(saved, 'a recipe save request should have been made').toBeTruthy();

  const ingredient = saved.ingredients.find((i: any) => i.name === ingredientName);
  expect(ingredient, `${ingredientName} should be in the save payload`).toBeTruthy();

  // The three fields the extractor proposed. Dropping any of them anywhere
  // between the route and here means the ingredient is never classified.
  expect(ingredient.baseUnit).toBe('gram');
  expect(ingredient.unitSizes).toEqual({ '': 150 });
}

test.describe('recipe import', () => {
  test('URL import carries an ingredient and its classification into the save payload', async ({ page, request }) => {
    const ingredientName = novel('url');
    const recipeName = `E2E URL Import ${runId}`;

    await page.route('**/api/parse-recipe-url', (route) =>
      route.fulfill({ json: parsedRecipe(recipeName, ingredientName) })
    );

    const payloads = captureSavePayload(page);

    await page.goto('/recipes/new');
    await page.getByRole('button', { name: 'Recipe Link' }).click();
    await page.getByLabel('Recipe URL').fill('https://example.com/a-recipe');
    // Filling alone does nothing: the parse fires on blur, Enter, or this
    // button. Clicking it is the least incidental of the three.
    await page.getByRole('button', { name: 'Fetch' }).click();

    // The form is populated from the parsed result before anything is saved.
    await expect(page.getByLabel('Recipe Name')).toHaveValue(recipeName);
    await expect(page.getByText(ingredientName)).toBeVisible();

    await page.getByRole('button', { name: 'Save Recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/\d+$/);

    expectClassificationInPayload(payloads, ingredientName);
    await deleteRecipeByName(request, recipeName);
  });

  test('photo import carries an ingredient and its classification into the save payload', async ({ page, request }) => {
    const ingredientName = novel('photo');
    const recipeName = `E2E Photo Import ${runId}`;

    // Photo Import is asynchronous: the upload returns a job id, and the page
    // polls until the job settles. Both halves need stubbing.
    // Matched on pathname, not a glob: the polling request carries ?jobId=…,
    // which a '**/api/recipe-image' glob does not match - so the real route ran
    // and failed on a missing Netlify Blobs token.
    await page.route((url) => url.pathname === '/api/recipe-image', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ json: { jobId: `e2e-job-${runId}` } })
        : route.fulfill({ json: { status: 'completed', result: parsedRecipe(recipeName, ingredientName) } })
    );

    const payloads = captureSavePayload(page);

    await page.goto('/recipes/new');
    await page.getByRole('button', { name: 'Import from Camera' }).click();
    // Any real file will do - the route is stubbed, so nothing ever reads it.
    // A path rather than an inline buffer because the e2e tsconfig has no
    // @types/node, so `Buffer` is not in scope here.
    await page.setInputFiles('input[type="file"]', 'specs/evidence/sidebar-alignment/after.png');

    await expect(page.getByLabel('Recipe Name')).toHaveValue(recipeName, { timeout: 15_000 });
    await expect(page.getByText(ingredientName)).toBeVisible();

    await page.getByRole('button', { name: 'Save Recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/\d+$/);

    expectClassificationInPayload(payloads, ingredientName);
    await deleteRecipeByName(request, recipeName);
  });

  test('manual paste carries an ingredient and its classification into the save payload', async ({ page, request }) => {
    const ingredientName = novel('paste');
    const recipeName = `E2E Paste Import ${runId}`;

    // The one path that goes through appendIngredients rather than
    // initialRecipe, and the one that was already working.
    await page.route('**/api/parse-recipe-text', (route) =>
      route.fulfill({ json: { ingredients: parsedRecipe(recipeName, ingredientName).ingredients } })
    );

    const payloads = captureSavePayload(page);

    await page.goto('/recipes/new');
    await page.getByRole('button', { name: 'Enter Manually' }).click();
    await page.getByLabel('Recipe Name').fill(recipeName);
    await page.getByPlaceholder('2 tbsp olive oil').fill(`2 ${ingredientName}`);
    await page.getByRole('button', { name: 'Parse ingredients' }).click();

    await expect(page.getByText(ingredientName)).toBeVisible();

    await page.getByRole('button', { name: 'Save Recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/\d+$/);

    expectClassificationInPayload(payloads, ingredientName);
    await deleteRecipeByName(request, recipeName);
  });
});

// Method Import: the same two sources, aimed at one field of a Recipe that
// already exists. Stubbed at the route for the same reason as above - the model
// is not what can break here, the journey from the pencil to a saved method is.
//
// Worth covering end to end rather than in Vitest alone because the feature is
// mostly plumbing between four places (the pencil's ?add=method, the edit page
// reading it, the form opening the panel, and the extracted text reaching the
// save payload), and each piece is individually correct in a way that says
// nothing about whether they are joined up.
test.describe('method import', () => {
  const importedMethod = '1. Mix everything together.\n2. Bake for 30 minutes.';

  // A Recipe with ingredients and no method - which is how nearly every
  // imported Recipe arrives, and the only state that shows the pencil.
  const methodlessRecipe = (name: string) => ({
    name,
    method: '',
    ingredients: [{ name: 'flour', quantity: '200', unit: 'gram' }],
  });

  test('the Method pencil leads to an import that fills the field in from a link', async ({ page, request }) => {
    const recipeName = `E2E Method Link ${runId}`;
    const id = await createRecipe(request, methodlessRecipe(recipeName));

    await page.route('**/api/parse-method-url', (route) => route.fulfill({ json: { method: importedMethod } }));

    await page.goto(`/recipes/${id}`);
    await page.getByRole('link', { name: 'Add a method' }).click();

    // The pencil is only worth anything if it lands on the Method with the
    // import already open - the edit form is long, and Method is at the bottom
    // of it on a phone.
    await expect(page).toHaveURL(new RegExp(`/recipes/${id}/edit\\?add=method$`));
    await expect(page.getByLabel('Recipe link')).toBeVisible();

    await page.getByLabel('Recipe link').fill('https://example.com/a-recipe');
    await page.getByRole('button', { name: 'Fetch' }).click();

    await expect(page.getByLabel('Method', { exact: true })).toHaveValue(importedMethod);

    await page.getByRole('button', { name: 'Update Recipe' }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${id}`));
    // Rendered as steps on the Recipe page, so the pencil is gone and the
    // section it pointed at is filled in.
    await expect(page.getByText('Bake for 30 minutes.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add a method' })).toHaveCount(0);

    await deleteRecipeById(request, id);
  });

  test('a photographed page fills the method in the same way', async ({ page, request }) => {
    const recipeName = `E2E Method Photo ${runId}`;
    const id = await createRecipe(request, methodlessRecipe(recipeName));

    // Asynchronous like whole-recipe Photo Import, and on the same route -
    // matched on pathname so the polling request's ?jobId= is caught too.
    await page.route((url) => url.pathname === '/api/recipe-image', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ json: { jobId: `e2e-method-job-${runId}` } })
        : route.fulfill({ json: { status: 'completed', result: { method: importedMethod } } })
    );

    await page.goto(`/recipes/${id}/edit?add=method`);
    await page.getByRole('button', { name: 'From a photo' }).click();
    await page.setInputFiles('input[type="file"]', 'specs/evidence/sidebar-alignment/after.png');

    await expect(page.getByLabel('Method', { exact: true })).toHaveValue(importedMethod, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Update Recipe' }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${id}`));
    await expect(page.getByText('Bake for 30 minutes.')).toBeVisible();

    await deleteRecipeById(request, id);
  });

  // The pencil only appears on an empty Method, but the panel is on the edit
  // form regardless - and a method the cook wrote is not something to lose to a
  // fetch they may have started before remembering they had one.
  test('offers rather than overwrites a method that is already there', async ({ page, request }) => {
    const recipeName = `E2E Method Kept ${runId}`;
    const id = await createRecipe(request, {
      ...methodlessRecipe(recipeName),
      method: 'My own method.',
    });

    await page.route('**/api/parse-method-url', (route) => route.fulfill({ json: { method: importedMethod } }));

    await page.goto(`/recipes/${id}/edit?add=method`);
    await page.getByLabel('Recipe link').fill('https://example.com/a-recipe');
    await page.getByRole('button', { name: 'Fetch' }).click();

    await expect(page.getByText('There is already a method here.')).toBeVisible();
    await expect(page.getByLabel('Method', { exact: true })).toHaveValue('My own method.');

    await page.getByRole('button', { name: 'Replace the method' }).click();
    await expect(page.getByLabel('Method', { exact: true })).toHaveValue(importedMethod);

    await deleteRecipeById(request, id);
  });
});
