import { openai, EXTRACTION_MODEL } from './openai-client';

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isVegetarian: { type: 'boolean' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          unit: { type: 'string' },
        },
        required: ['name', 'quantity', 'unit'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'isVegetarian', 'ingredients'],
  additionalProperties: false,
};

function buildPrompt(text, knownIngredients, knownUnits) {
  return `
    Read the following recipe content (it may be a freehand pasted ingredient list, or text/HTML
    scraped from a recipe web page) and extract:

    - name: the recipe's name/title. If this is just a pasted ingredient list with no title, use
      an empty string.
    - isVegetarian: true only if none of the ingredients are meat, poultry, fish, or a
      meat/fish-derived product (e.g. gelatine, fish sauce, chicken stock).
    - ingredients: an array of {name, quantity, unit}.

    For each ingredient:
    - Standardize the unit to one of: ${knownUnits.length ? knownUnits.join(',') : 'bottle,clove,gram,kilogram,litre,millilitre,packet,pinch,slice,tablespoon,teaspoon,tin'}.
      Translate abbreviations (tsp -> teaspoon). Convert unicode fraction characters (½, ¾, etc)
      and dual-unit notation (e.g. "200g/7oz") into a single decimal quantity in the first
      standardized unit that applies. If no unit applies or it can't be standardized, leave it
      as an empty string.
    - Ingredient names should be lowercase and singular, with no preparation notes ("chopped",
      "halved", "seeds removed", "roughly torn" etc) - just the ingredient itself.
    - ${knownIngredients.length ? `Here is a list of ingredient names already used elsewhere in this app: ${knownIngredients.join(', ')}. If an ingredient clearly refers to one of these (allowing for pluralisation, adjectives, or minor wording differences), reuse that exact existing name rather than inventing a new, similar one. Only use a new name when none of the existing ones are a reasonable match.` : ''}
    - Preserve the original order of the ingredients.
    - Ignore anything that isn't part of the ingredient list (navigation, ads, comments, related
      recipes, etc), if this looks like a full scraped page rather than a plain list.

    Recipe content:
    ${text}
  `;
}

export async function extractRecipeIngredients({ text, knownIngredients = [], knownUnits = [] }) {
  const response = await openai.responses.create({
    model: EXTRACTION_MODEL,
    input: buildPrompt(text, knownIngredients, knownUnits),
    text: {
      format: {
        type: 'json_schema',
        name: 'recipe_ingredients',
        schema: SCHEMA,
        strict: true,
      },
    },
  });

  return JSON.parse(response.output_text);
}
