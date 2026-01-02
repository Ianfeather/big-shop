/**
 * Mock API Server for Dave Evaluations
 * Provides fake recipe data for testing without auth requirements
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Mock recipe data
const MOCK_RECIPES = [
  {
    id: "1",
    name: "Thai Green Curry",
    description: "Spicy coconut curry with vegetables",
    tags: ["Thai", "Spicy", "Vegetarian", "Quick"],
    ingredients: [
      { name: "Coconut milk", quantity: "400", unit: "ml" },
      { name: "Green curry paste", quantity: "2", unit: "tablespoon" },
      { name: "Vegetables", quantity: "300", unit: "gram" }
    ],
    servings: 4,
    cookTime: 25
  },
  {
    id: "2",
    name: "Pasta Carbonara",
    description: "Classic Italian pasta with eggs and cheese",
    tags: ["Italian", "Pasta", "Quick", "Comfort Food"],
    ingredients: [
      { name: "Spaghetti", quantity: "400", unit: "gram" },
      { name: "Eggs", quantity: "3", unit: "piece" },
      { name: "Parmesan cheese", quantity: "100", unit: "gram" },
      { name: "Pancetta", quantity: "150", unit: "gram" }
    ],
    servings: 4,
    cookTime: 20
  },
  {
    id: "3",
    name: "Chicken Tikka Masala",
    description: "Creamy Indian chicken curry",
    tags: ["Indian", "Chicken", "Curry", "Batch Cook"],
    ingredients: [
      { name: "Chicken breast", quantity: "500", unit: "gram" },
      { name: "Tomato sauce", quantity: "400", unit: "gram" },
      { name: "Heavy cream", quantity: "200", unit: "ml" },
      { name: "Tikka masala spice", quantity: "2", unit: "tablespoon" }
    ],
    servings: 4,
    cookTime: 45
  },
  {
    id: "4",
    name: "Greek Salad",
    description: "Fresh Mediterranean salad",
    tags: ["Greek", "Salad", "Healthy", "Vegetarian"],
    ingredients: [
      { name: "Cucumber", quantity: "1", unit: "piece" },
      { name: "Tomatoes", quantity: "3", unit: "piece" },
      { name: "Feta cheese", quantity: "200", unit: "gram" },
      { name: "Olive oil", quantity: "3", unit: "tablespoon" }
    ],
    servings: 2,
    cookTime: 10
  }
];

// Mock shopping list storage
let mockShoppingList = {
  recipes: [],
  ingredients: {},
  extras: {}
};

// API Routes

// GET /recipes - Return all recipes
app.get('/recipes', (req, res) => {
  console.log('📋 Mock API: Getting all recipes');
  res.json(MOCK_RECIPES);
});

// GET /recipe/:id - Get specific recipe
app.get('/recipe/:id', (req, res) => {
  console.log(`📋 Mock API: Getting recipe ${req.params.id}`);
  const recipe = MOCK_RECIPES.find(r => r.id === req.params.id);

  if (!recipe) {
    return res.status(404).json({ error: 'Recipe not found' });
  }

  res.json(recipe);
});

// GET /shopping-list - Get current shopping list
app.get('/shopping-list', (req, res) => {
  console.log('🛒 Mock API: Getting shopping list');
  res.json(mockShoppingList);
});

// POST /shopping-list - Create/update shopping list
app.post('/shopping-list', (req, res) => {
  console.log('🛒 Mock API: Creating shopping list with recipes:', req.body);

  const recipeIds = req.body;

  if (!Array.isArray(recipeIds)) {
    return res.status(400).json({ error: 'Expected array of recipe IDs' });
  }

  // Find recipes and combine ingredients
  const selectedRecipes = MOCK_RECIPES.filter(recipe =>
    recipeIds.includes(recipe.id)
  );

  const combinedIngredients = {};

  selectedRecipes.forEach(recipe => {
    recipe.ingredients.forEach(ingredient => {
      if (combinedIngredients[ingredient.name]) {
        // Simple addition for testing - real app would handle unit conversion
        const currentQty = parseFloat(combinedIngredients[ingredient.name].quantity) || 0;
        const newQty = parseFloat(ingredient.quantity) || 0;
        combinedIngredients[ingredient.name] = {
          quantity: (currentQty + newQty).toString(),
          unit: ingredient.unit,
          isBought: false
        };
      } else {
        combinedIngredients[ingredient.name] = {
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          isBought: false
        };
      }
    });
  });

  mockShoppingList = {
    recipes: recipeIds,
    ingredients: combinedIngredients,
    extras: mockShoppingList.extras // Preserve existing extras
  };

  res.json(mockShoppingList);
});

// DELETE /shopping-list/clear - Clear shopping list
app.delete('/shopping-list/clear', (req, res) => {
  console.log('🗑️ Mock API: Clearing shopping list');

  mockShoppingList = {
    recipes: [],
    ingredients: {},
    extras: {}
  };

  res.json(mockShoppingList);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'dave-mock-api' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Mock API Server running on http://localhost:${PORT}`);
  console.log('📋 Available endpoints:');
  console.log('  GET  /recipes - All recipes');
  console.log('  GET  /recipe/:id - Specific recipe');
  console.log('  GET  /shopping-list - Current shopping list');
  console.log('  POST /shopping-list - Create shopping list');
  console.log('  GET  /health - Health check');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down mock API server...');
  server.close(() => {
    console.log('✅ Mock API server closed');
    process.exit(0);
  });
});

module.exports = app;
