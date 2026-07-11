import { openai, EXTRACTION_MODEL } from './openai-client';

const SCHEMA = {
  type: 'object',
  properties: {
    method: { type: 'string' },
  },
  required: ['method'],
  additionalProperties: false,
};

function buildPrompt(text) {
  return `
    Read the following recipe content (text/HTML scraped from a recipe web page) and extract just
    the cooking method/instructions, ignoring the ingredient list, navigation, ads, comments, and
    related recipes.

    Format the method in markdown, as clearly as possible. Each instruction should be its own
    numbered line, e.g. "1. Preheat the oven.\\n2. Mix the ingredients.\\n3. Bake for 30 minutes."
    If a step is itself a list of items, format it as a nested markdown list. The method must NOT
    use double quotes (") at any point - replace them with a single quote if needed, or omit them.
    If no method/instructions can be found, return an empty string.

    Recipe content:
    ${text}
  `;
}

export async function extractRecipeMethod({ text }) {
  const response = await openai.responses.create({
    model: EXTRACTION_MODEL,
    input: buildPrompt(text),
    text: {
      format: {
        type: 'json_schema',
        name: 'recipe_method',
        schema: SCHEMA,
        strict: true,
      },
    },
  });

  return JSON.parse(response.output_text);
}
