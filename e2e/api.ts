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
  await request.delete(`${API_HOST}/recipe`, { data: { id } });
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
