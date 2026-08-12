// Tool functions for Dave to interact with the existing Big Shop APIs

import type OpenAI from 'openai';
import type { Recipe, RecipeSummary } from '../../types/models';
import { serverApiHost } from '../api-host';
import { withTraceHeaders } from '../telemetry/propagate';
import { toolSpan } from '../telemetry/tool-span';
import { safeErrorMessage } from '../telemetry/span';

// Where these tools reach the Go API.
//
// API_HOST_INTERNAL, not NEXT_PUBLIC_API_HOST: these run in a Netlify function,
// where the latter's production value is a relative path (see lib/api-host.ts).
// Going direct to Fly also skips a leg - the alternative is us-east-2 ->
// Netlify's edge -> Frankfurt, on several calls per turn.
//
// Extracted rather than repeated at each of the four call sites, so there is
// one place to change and one place to test.
export function toolApiHost(useMockApi: boolean): string | undefined {
  return useMockApi ? 'http://localhost:3001' : serverApiHost();
}

/**
 * Search recipes in the user's collection
 */
export async function searchRecipes({ query = '', tags = '' }: { query?: string; tags?: string }, authToken: string, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = toolApiHost(useMockApi);

    // For now, just fetch all recipes and filter client-side
    // TODO: Add proper search parameters to the API
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/recipes`, { headers: withTraceHeaders(headers) });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    // GET /recipes returns RecipeSummary[] - id/name/tags only, no
    // description or ingredients (see types/api.d.ts). Typed as `any[]`
    // before, this filtered/displayed a `description` field that never
    // existed on the response, silently disabling that part of search.
    const allRecipes: RecipeSummary[] = (await response.json()) ?? [];

    // Simple client-side filtering for now
    let filteredRecipes = allRecipes;

    if (query) {
      const searchTerm = query.toLowerCase();
      filteredRecipes = allRecipes.filter((recipe) =>
        recipe.name.toLowerCase().includes(searchTerm)
      );
    }

    if (tags) {
      const searchTags = tags.toLowerCase();
      filteredRecipes = filteredRecipes.filter((recipe) =>
        recipe.tags?.some((tag) =>
          tag.toLowerCase().includes(searchTags)
        )
      );
    }


    return {
      success: true,
      recipes: filteredRecipes.map((recipe, index) => ({
        id: recipe.id,
        name: recipe.name,
        tags: recipe.tags,
        // Clean user-facing display
        displayText: `${index + 1}. ${recipe.name}`,
        // Internal mapping for AI (not shown to user)
        internalId: recipe.id,
        position: index + 1
      })),
      message: query
        ? `Found ${filteredRecipes.length} recipes matching "${query}"`
        : `Found ${filteredRecipes.length} recipes in your collection`
    };
  } catch (error) {
    return {
      success: false,
      error: safeErrorMessage(error),
      message: 'Failed to search recipes'
    };
  }
}

/**
 * Get detailed recipe information
 */
export async function getRecipeDetails({ recipeId }: { recipeId: string }, authToken: string, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = toolApiHost(useMockApi);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/recipe/${recipeId}`, { headers: withTraceHeaders(headers) });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const recipe: Recipe = await response.json();

    return {
      success: true,
      recipe: recipe
    };
  } catch (error) {
    return {
      success: false,
      error: safeErrorMessage(error),
      message: 'Failed to get recipe details'
    };
  }
}

/**
 * Get historical shopping list patterns for meal planning
 */
export async function getShoppingHistory(args: unknown, authToken: string, useMockApi = false) {
  try {
    const apiHost = toolApiHost(useMockApi);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/shopping-list/history`, { headers: withTraceHeaders(headers) });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const historyData = await response.json();

    return {
      success: true,
      history: historyData,
      message: `Found ${historyData.recent_recipes.length} recent recipes and ${historyData.favorite_recipes.length} favorites`
    };
  } catch (error) {
    return {
      success: false,
      error: safeErrorMessage(error),
      message: 'Failed to get shopping history'
    };
  }
}

/**
 * Create shopping list from selected recipes
 */
export async function createShoppingList({ recipeIds }: { recipeIds: string[] }, authToken: string, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = toolApiHost(useMockApi);

    // First, fetch existing shopping list
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const existingResponse = await fetch(`${apiHost}/shopping-list`, { headers: withTraceHeaders(headers) });

    let existingRecipeIds = [];
    if (existingResponse.ok) {
      const existingList = await existingResponse.json();
      existingRecipeIds = existingList.recipes || [];
    }

    // Combine existing recipe IDs with new ones (remove duplicates)
    const combinedRecipeIds = [...new Set([...existingRecipeIds, ...recipeIds])];

    // Create/update shopping list with combined recipes
    const postHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      postHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/shopping-list`, {
      method: 'POST',
      headers: withTraceHeaders(postHeaders),
      body: JSON.stringify(combinedRecipeIds)
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const shoppingList = await response.json();

    const isAdding = existingRecipeIds.length > 0;
    const action = isAdding ? 'added to' : 'created for';

    return {
      success: true,
      shoppingList: shoppingList,
      message: `Shopping list ${action} ${recipeIds.length} recipes. Total recipes: ${combinedRecipeIds.length}`
    };
  } catch (error) {
    return {
      success: false,
      error: safeErrorMessage(error),
      message: 'Failed to update shopping list'
    };
  }
}

// Tool definitions for OpenAI function calling
export const availableTools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_recipes',
      description: 'Search the user\'s recipe collection. Use both query and tags for best results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Primary search term: ingredient, dish name, cooking method (e.g., "curry", "chicken", "pasta"). Use this for most searches.'
          },
          tags: {
            type: 'string',
            description: 'Additional tag filter: cuisine, dietary preferences, meal type, features (e.g., "Thai", "vegetarian", "Batch Cook"). Use alongside query when user mentions specific attributes.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_shopping_history',
      description: 'Get historical shopping list patterns to suggest frequently used or recently added recipes for meal planning. Use this when the user asks about meal planning, suggests for this week, or wants recommendations based on their cooking habits.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recipe_details',
      description: 'Get full details for a specific recipe',
      parameters: {
        type: 'object',
        properties: {
          recipeId: {
            type: 'string',
            description: 'The ID of the recipe to retrieve'
          }
        },
        required: ['recipeId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_shopping_list',
      description: `
      Use this function whenever the user expresses an intent to add one or more recipes to their shopping list.

      Call this tool if the user:
      - Explicitly asks to add a recipe or recipes to their shopping list
      - Uses phrases like "add to shopping list", "add this recipe", "put this on my list", "add ingredients", "save for shopping", or similar wording
      - Refers to previously shown or selected recipes and indicates they want them added

      Do NOT respond with a confirmation message alone.
      You MUST call this function instead of saying that the list was updated.

      This function should be called even if the user’s wording is casual, indirect, or implied, as long as the intent is clearly to add recipes for shopping.
      `,
      parameters: {
        type: 'object',
        properties: {
          recipeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of recipe IDs from search results. Use the "id" field from recipe objects returned by search_recipes.'
          }
        },
        required: ['recipeIds']
      }
    }
  }
];

// Execute tool calls
//
// The span is taken here rather than inside each of the four tools for the same
// reason toolApiHost is extracted above: this is the one place every tool call
// passes through, so it is one place to change and one place to test. Each
// tool's own fetch then runs inside that span, which is what gives the
// traceparent injected above something to name - and what makes the Go API's
// server span, and the `otelsql` query spans beneath it, hang off the tool that
// caused them instead of floating in a trace of their own.
//
// An unknown tool throws before a span is started. It is a programming error in
// availableTools rather than something that happened to a request, and there is
// nothing about it worth a trace.
export async function executeToolCall(toolName: string, args: any, authToken: string, useMockApi = false) {
  switch (toolName) {
    case 'search_recipes':
      return await toolSpan(toolName, () => searchRecipes(args, authToken, useMockApi));
    case 'get_recipe_details':
      return await toolSpan(toolName, () => getRecipeDetails(args, authToken, useMockApi));
    case 'get_shopping_history':
      return await toolSpan(toolName, () => getShoppingHistory(args, authToken, useMockApi));
    case 'create_shopping_list':
      return await toolSpan(toolName, () => createShoppingList(args, authToken, useMockApi));
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
