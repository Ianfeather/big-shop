// Tool functions for Dave to interact with the existing Big Shop APIs

/**
 * Search recipes in the user's collection
 */
export async function searchRecipes({ query = '', tags = '' }, authToken) {
  try {
    const apiHost = process.env.NEXT_PUBLIC_API_HOST;

    // For now, just fetch all recipes and filter client-side
    // TODO: Add proper search parameters to the API
    const response = await fetch(`${apiHost}/recipes`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

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
      recipes: filteredRecipes,
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
export async function getRecipeDetails({ recipeId }, authToken) {
  try {
    const apiHost = process.env.NEXT_PUBLIC_API_HOST;

    const response = await fetch(`${apiHost}/recipe/${recipeId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

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
export async function createShoppingList({ recipeIds }, authToken) {
  try {
    const apiHost = process.env.NEXT_PUBLIC_API_HOST;

    const response = await fetch(`${apiHost}/shopping-list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(recipeIds)
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const shoppingList = await response.json();

    return {
      success: true,
      shoppingList: shoppingList,
      message: `Shopping list created for ${recipeIds.length} recipes`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to create shopping list'
    };
  }
}

// Tool definitions for OpenAI function calling
export const availableTools = [
  {
    type: 'function',
    function: {
      name: 'search_recipes',
      description: 'Search the user\'s recipe collection',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term for recipes (ingredient, dish name, etc.)'
          },
          tags: {
            type: 'string',
            description: 'tags such as cuisine (e.g., Italian, Indian, Mexican), dietary preferences (e.g., vegetarian), meal type (e.g., breakfast, dinner), meal features (e.g. Batch Cook)'
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
      description: 'Generate a shopping list from selected recipes',
      parameters: {
        type: 'object',
        properties: {
          recipeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of recipe IDs to include in shopping list'
          }
        },
        required: ['recipeIds']
      }
    }
  }
];

// Execute tool calls
export async function executeToolCall(toolName, args, authToken) {
  console.log({toolName});
  switch (toolName) {
    case 'search_recipes':
      return await searchRecipes(args, authToken);
    case 'get_recipe_details':
      return await getRecipeDetails(args, authToken);
    case 'create_shopping_list':
      return await createShoppingList(args, authToken);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
