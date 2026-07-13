import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchRecipes,
  getRecipeDetails,
  getShoppingHistory,
  createShoppingList,
  executeToolCall
} from './tools';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const recipes = [
  { id: '1', name: 'Chicken Curry', description: 'A mild curry', tags: ['Curry'], ingredients: [{ name: 'chicken' }] },
  { id: '2', name: 'Veggie Chilli', description: '', tags: ['Vegetarian'], ingredients: [{ name: 'kidney beans' }] }
];

describe('searchRecipes', () => {
  it('filters by query across name/description/ingredients and shapes the result', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(recipes));

    const result = await searchRecipes({ query: 'chicken' }, 'token', true);

    expect(result.success).toBe(true);
    expect(result.recipes).toEqual([
      { id: '1', name: 'Chicken Curry', description: 'A mild curry', tags: ['Curry'], displayText: '1. Chicken Curry - A mild curry', internalId: '1', position: 1 }
    ]);
    expect(result.message).toBe('Found 1 recipes matching "chicken"');
  });

  it('filters by tags', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(recipes));

    const result = await searchRecipes({ tags: 'vegetarian' }, 'token', true);

    expect(result.recipes.map(r => r.id)).toEqual(['2']);
  });

  it('returns all recipes with a default message when no query/tags given', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(recipes));

    const result = await searchRecipes({}, 'token', true);

    expect(result.recipes).toHaveLength(2);
    expect(result.message).toBe('Found 2 recipes in your collection');
  });

  it('returns a failure result when the API responds with an error', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(null, false));

    const result = await searchRecipes({}, 'token', true);

    expect(result).toEqual({
      success: false,
      error: 'API request failed: 500',
      message: 'Failed to search recipes'
    });
  });
});

describe('getRecipeDetails', () => {
  it('returns the recipe on success', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ id: '1', name: 'Chicken Curry' }));

    const result = await getRecipeDetails({ recipeId: '1' }, 'token', true);

    expect(result).toEqual({ success: true, recipe: { id: '1', name: 'Chicken Curry' } });
  });

  it('returns a failure result when the request errors', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(null, false));

    const result = await getRecipeDetails({ recipeId: 'missing' }, 'token', true);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to get recipe details');
  });
});

describe('getShoppingHistory', () => {
  it('summarises recent/favorite recipe counts', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ recent_recipes: [1, 2], favorite_recipes: [1] }));

    const result = await getShoppingHistory({}, 'token', true);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Found 2 recent recipes and 1 favorites');
  });
});

describe('createShoppingList', () => {
  it('merges new recipe ids with the existing list, deduping, and reports "added to"', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ recipes: ['1'] })) // existing list GET
      .mockResolvedValueOnce(jsonResponse({ recipes: ['1', '2'] })); // POST response

    const result = await createShoppingList({ recipeIds: ['1', '2'] }, 'token', true);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Shopping list added to 2 recipes. Total recipes: 2');
    const [, postCall] = fetch.mock.calls;
    expect(JSON.parse(postCall[1].body)).toEqual(['1', '2']);
  });

  it('reports "created for" when there was no existing list', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(null, false)) // existing list fetch fails -> treated as empty
      .mockResolvedValueOnce(jsonResponse({ recipes: ['3'] }));

    const result = await createShoppingList({ recipeIds: ['3'] }, 'token', true);

    expect(result.message).toBe('Shopping list created for 1 recipes. Total recipes: 1');
  });

  it('returns a failure result when the final update request fails', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ recipes: [] }))
      .mockResolvedValueOnce(jsonResponse(null, false));

    const result = await createShoppingList({ recipeIds: ['1'] }, 'token', true);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to update shopping list');
  });
});

describe('executeToolCall', () => {
  it('dispatches to the named tool', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(recipes));

    const result = await executeToolCall('search_recipes', { query: 'chilli' }, 'token', true);

    expect(result.success).toBe(true);
  });

  it('throws for an unknown tool name', async () => {
    await expect(executeToolCall('not_a_real_tool', {}, 'token', true)).rejects.toThrow('Unknown tool: not_a_real_tool');
  });
});
