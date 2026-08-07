import type { APIRequestContext } from '@playwright/test';
import { API_HOST } from './env';

// Fixtures go straight through the Go API rather than the UI so that (a)
// test setup/teardown doesn't depend on the UI flow under test and (b)
// Recipe creation never has to go through the "Parse ingredients" bulk box,
// which makes a real LLM call (/api/parse-recipe-text) - exactly the kind of
// external, flaky/costly dependency these tests are trying to avoid. Recipe
// creation via POST /recipe doesn't return the new row, so callers that need
// the id look it up afterwards via GET /recipes.

type Recipe = {
  name: string;
  remoteUrl?: string;
  notes?: string;
  method?: string;
  ingredients?: { name: string; quantity: string; unit: string }[];
  tags?: string[];
};

export async function createRecipe(request: APIRequestContext, recipe: Recipe): Promise<number> {
  const res = await request.post(`${API_HOST}/recipe`, {
    data: {
      remoteUrl: '',
      notes: '',
      method: '',
      ingredients: [],
      tags: [],
      ...recipe,
    },
  });
  if (!res.ok()) {
    throw new Error(`Failed to create fixture recipe "${recipe.name}": ${res.status()} ${await res.text()}`);
  }
  return findRecipeIdByName(request, recipe.name);
}

export async function findRecipeIdByName(request: APIRequestContext, name: string): Promise<number> {
  const res = await request.get(`${API_HOST}/recipes`);
  const recipes = await res.json();
  const match = recipes.find((r: { id: number; name: string }) => r.name === name);
  if (!match) {
    throw new Error(`No recipe named "${name}" found via GET /recipes`);
  }
  return match.id;
}

export async function deleteRecipeById(request: APIRequestContext, id: number): Promise<void> {
  // Asserted, deliberately. This silently swallowed failures for months: every
  // Recipe that reached a Shopping List failed to delete (follow-ups.md #24)
  // and the suite never noticed, because teardown ignored the status.
  const res = await request.delete(`${API_HOST}/recipe`, { data: { id } });
  if (!res.ok()) {
    throw new Error(`Failed to delete recipe ${id}: ${res.status()} ${await res.text()}`);
  }
}

export async function deleteRecipeByName(request: APIRequestContext, name: string): Promise<void> {
  const res = await request.get(`${API_HOST}/recipes`);
  const recipes = await res.json();
  const match = recipes.find((r: { id: number; name: string }) => r.name === name);
  if (match) {
    await deleteRecipeById(request, match.id);
  }
}

export async function clearShoppingList(request: APIRequestContext): Promise<void> {
  await request.delete(`${API_HOST}/shopping-list/clear`);
}

// The Pantry Staples toggle is stored on the User, so under DISABLE_AUTH it is
// one more piece of state shared by every test in the run - the same hazard the
// Shopping List has. A test that cares which way the group starts has to say
// so rather than inherit whatever the last one left behind.
export async function setShowPantryStaples(request: APIRequestContext, show: boolean): Promise<void> {
  const res = await request.patch(`${API_HOST}/user/preferences`, { data: { showPantryStaples: show } });
  if (!res.ok()) {
    throw new Error(`Failed to set showPantryStaples: ${res.status()} ${await res.text()}`);
  }
}

export async function addRecipesToList(request: APIRequestContext, ids: number[]): Promise<void> {
  const res = await request.post(`${API_HOST}/shopping-list`, { data: ids.map(String) });
  if (!res.ok()) {
    throw new Error(`Failed to generate shopping list: ${res.status()} ${await res.text()}`);
  }
}
