// Tool functions for Dave to interact with the existing Big Shop APIs

/**
 * Search recipes in the user's collection
 */
export async function searchRecipes({ query = '', tags = '' }, authToken, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = useMockApi ? 'http://localhost:3001' : process.env.NEXT_PUBLIC_API_HOST;

    // For now, just fetch all recipes and filter client-side
    // TODO: Add proper search parameters to the API
    const headers = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/recipes`, { headers });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const allRecipes = await response.json();

    // Simple client-side filtering for now
    let filteredRecipes = allRecipes;

    if (query) {
      const searchTerm = query.toLowerCase();
      filteredRecipes = allRecipes.filter(recipe =>
        recipe.name.toLowerCase().includes(searchTerm) ||
        recipe.description?.toLowerCase().includes(searchTerm) ||
        recipe.ingredients?.some(ing =>
          ing.name.toLowerCase().includes(searchTerm)
        )
      );
    }

    if (tags) {
      const searchTags = tags.toLowerCase();
      filteredRecipes = filteredRecipes.filter(recipe =>
        recipe.tags?.some(tag =>
          tag.toLowerCase().includes(searchTags)
        )
      );
    }


    return {
      success: true,
      recipes: filteredRecipes.map((recipe, index) => ({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        tags: recipe.tags,
        // Clean user-facing display
        displayText: `${index + 1}. ${recipe.name}${recipe.description ? ` - ${recipe.description}` : ''}`,
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
      error: error.message,
      message: 'Failed to search recipes'
    };
  }
}

/**
 * Get detailed recipe information
 */
export async function getRecipeDetails({ recipeId }, authToken, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = useMockApi ? 'http://localhost:3001' : process.env.NEXT_PUBLIC_API_HOST;

    const headers = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/recipe/${recipeId}`, { headers });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const recipe = await response.json();

    return {
      success: true,
      recipe: recipe
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get recipe details'
    };
  }
}

/**
 * Create shopping list from selected recipes
 */
export async function createShoppingList({ recipeIds }, authToken, useMockApi = false) {
  try {
    // Use mock API for testing, otherwise use remote API
    const apiHost = useMockApi ? 'http://localhost:3001' : process.env.NEXT_PUBLIC_API_HOST;

    // First, fetch existing shopping list
    const headers = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const existingResponse = await fetch(`${apiHost}/shopping-list`, { headers });

    let existingRecipeIds = [];
    if (existingResponse.ok) {
      const existingList = await existingResponse.json();
      existingRecipeIds = existingList.recipes || [];
    }

    // Combine existing recipe IDs with new ones (remove duplicates)
    const combinedRecipeIds = [...new Set([...existingRecipeIds, ...recipeIds])];

    // Create/update shopping list with combined recipes
    const postHeaders = { 'Content-Type': 'application/json' };
    if (!useMockApi) {
      postHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${apiHost}/shopping-list`, {
      method: 'POST',
      headers: postHeaders,
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
      error: error.message,
      message: 'Failed to update shopping list'
    };
  }
}

// Tool definitions for OpenAI function calling
export const availableTools = [
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
export async function executeToolCall(toolName, args, authToken, useMockApi = false) {
  switch (toolName) {
    case 'search_recipes':
      return await searchRecipes(args, authToken, useMockApi);
    case 'get_recipe_details':
      return await getRecipeDetails(args, authToken, useMockApi);
    case 'create_shopping_list':
      return await createShoppingList(args, authToken, useMockApi);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
