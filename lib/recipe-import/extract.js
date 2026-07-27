import { openai, EXTRACTION_MODEL } from '../openai-client';

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
    method: { type: 'string' },
    // Catalog metadata for ingredients this app has never seen. Every property
    // is required and nulls are explicit because OpenAI's strict structured
    // outputs disallow optional properties - "absent" has to be spelled null.
    newIngredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          baseUnit: { type: ['string', 'null'] },
          displayUnit: { type: ['string', 'null'] },
          unitSizes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                unit: { type: 'string' },
                size: { type: 'number' },
              },
              required: ['unit', 'size'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'baseUnit', 'displayUnit', 'unitSizes'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'isVegetarian', 'ingredients', 'method', 'newIngredients'],
  additionalProperties: false,
};

const DEFAULT_UNITS = 'bottle,clove,gram,kilogram,litre,millilitre,packet,pinch,slice,tablespoon,teaspoon,tin';

function buildInstructions(knownIngredients, knownUnits) {
  return `
    Read the following recipe content - it may be a freehand pasted ingredient list, text/HTML
    scraped from a recipe web page, or an attached photo of a recipe (e.g. from a cookbook) - and
    extract:

    - name: the recipe's name/title. If this is just a pasted ingredient list with no title, use
      an empty string.
    - isVegetarian: true only if none of the ingredients are meat, poultry, fish, or a
      meat/fish-derived product (e.g. gelatine, fish sauce, chicken stock).
    - ingredients: an array of {name, quantity, unit}.
    - method: the cooking method/instructions, formatted in markdown as clearly as possible. Each
      instruction should be its own numbered line, e.g. "1. Preheat the oven.\\n2. Mix the
      ingredients.\\n3. Bake for 30 minutes." If a step is itself a list of items, format it as a
      nested markdown list. The method must NOT use double quotes (") at any point - replace them
      with a single quote if needed, or omit them. If no method/instructions can be found (e.g. a
      bare ingredient list), return an empty string.

    These ingredients will later be combined across multiple recipes into a single shopping list,
    so consistent naming and units matter more than anything else - two ingredients that are the
    same thing must always end up with the exact same name and unit, or they won't combine.

    Pantry staples:
    - Omit these specific items entirely from the ingredients array when used in a small,
      seasoning/background amount: salt, pepper, any cooking oil (olive oil, vegetable oil,
      sunflower oil, etc), flour (plain flour, self-raising flour, etc), butter, and sugar
      (caster sugar, brown sugar, etc). These are near-universal pantry basics, and listing
      "1 tbsp olive oil" or "pinch of salt" on every recipe adds shopping-list noise for
      something almost everyone already has. Do NOT extend this to any other ingredient no
      matter how common it seems - keep garlic, onion, stock, spices, herbs, water, etc even in
      small amounts.
    - Only omit when the amount is small - roughly: oil up to 2-3 tbsp, salt/pepper any amount
      (they're essentially always seasoning-scale), flour up to ~3 tbsp, butter up to ~2 tbsp or
      a small knob, sugar up to ~2 tbsp. If one of these six is used in a larger quantity, it's a
      primary ingredient rather than a pantry basic (e.g. "200g plain flour" in a cake, "150g
      butter" in pastry, "100g sugar" in a dessert) - keep it, with its real quantity/unit as
      normal, and it's still governed by the naming/unit rules below like any other ingredient.
    - If genuinely unsure whether an amount counts as "small" for one of these six, err on the
      side of keeping it in the list - a spare shopping list item is better than silently
      dropping something the cook actually needs to buy.

    Ingredient names:
    - Lowercase and singular, with no preparation notes ("chopped", "halved", "seeds removed",
      "roughly torn" etc) - just the ingredient itself.
    - Use a consistent word order and drop redundant parenthetical/comma qualifiers that don't
      change what you'd buy (e.g. "butter, unsalted" and "unsalted butter" should both become
      "unsalted butter" - the same string every time), but keep qualifiers that describe a
      genuinely different product you'd pick up off a different shelf (e.g. "unsalted butter" is
      not the same purchase as "butter", "self-raising flour" is not "flour").
    - ${knownIngredients.length ? `Here is a list of ingredient names already used elsewhere in this app: ${knownIngredients.join(', ')}. If an ingredient clearly refers to one of these (allowing for pluralisation, adjectives, or minor wording differences), you MUST reuse that exact existing string rather than inventing a new, similarly-worded one. Only use a new name when none of the existing ones are a reasonable match, and when you do, follow the same naming style as the existing list.` : ''}

    Quantities:
    - Use decimals, not fractions. Convert unicode fraction characters (½, ¾, etc) to decimals.
    - If a quantity is given as a range (e.g. "4-6", "6-8 thighs", "2 to 3"), use the midpoint as a
      single decimal number (e.g. "5", "7", "2.5") - ranges can't be summed across recipes.

    Units:
    - A blank unit (empty string) is a normal, common, and CORRECT answer whenever the recipe
      gives a plain count with no unit word at all - e.g. "3 tomatoes" -> quantity "3", unit "",
      "2 eggs" -> quantity "2", unit "", "4 chicken thighs" -> quantity "4", unit "". This happens
      often; don't treat it as something to avoid. In particular, do NOT invent or force-fit a
      generic counting unit (e.g. "whole", "piece", "each") onto one of these just because
      something like that happens to already exist in the known units list below - only use a
      unit if the recipe text itself uses one.
    - When the recipe text DOES give a unit, standardize it to one of these: ${knownUnits.length ? knownUnits.join(',') : DEFAULT_UNITS}.
      This list includes both standard measures and any one-off units already in use elsewhere in
      this app - prefer reusing one of these over inventing a new one. Translate abbreviations
      (tsp -> teaspoon).
    - When a quantity is given in both metric and imperial/US customary units (e.g. "200g/7oz",
      "1lb/454g", "8fl oz/225ml"), always use the metric one, regardless of which one appears
      first in the text.
    - If a quantity is given ONLY in an imperial/US customary unit (oz, lb, fl oz, cup, pint,
      quart) with no metric alternative given, convert it to the closest standardized metric unit
      using standard approximate cooking conversions (e.g. 8oz -> 227 gram, 1lb -> 454 gram) rather
      than leaving the unit blank.
    - If the recipe text gives a unit but none of the above are a reasonable fit (e.g. a "bunch"
      or "sprig" or "head" of something with no equivalent in the list), do not blank it out -
      use a new, sensible unit instead: lowercase, singular, and as short/generic as possible
      (e.g. "bunch" not "large bunch"), so future recipes needing the same unit will match it.

    New ingredients:
    - newIngredients: metadata for ingredients this app has not seen before.${knownIngredients.length ? ' That means anything not in the known-ingredient list given above; for anything in that list, output nothing - this app already has curated values and they must not be second-guessed.' : ' This app currently knows no ingredients, so every ingredient here is new.'}
      Return an empty array if there are none.
    - The purpose is combining a shopping list. If two recipes call for "3 onions" and "150g
      onion", the app can only add them together if it knows roughly what one onion weighs.
    - baseUnit: "millilitre" for things bought by volume (oils, stocks, milks, wines,
      juices, sauces thin enough to pour), "gram" for everything else. Use null if unsure -
      null means gram, which is right far more often than not.
    - unitSizes: how much ONE of a unit of this ingredient is, expressed in its baseUnit.
      Only include entries that are genuinely useful:
        * unit "" (empty string, the bare count) - how much one of them is, in this
          ingredient's own baseUnit: one onion 150 (grams), one carrot 80, one chicken breast
          180, and for a volume-based ingredient one lemon's juice 70 (millilitres). This is
          the most valuable entry by far; include it for anything a recipe might count.
        * unit "millilitre" - grams per millilitre, i.e. density, for a dry ingredient that
          recipes measure in spoons: plain flour 0.53, caster sugar 0.85, ground spices
          around 0.5. Every spoon measure derives from this one number, so do not add
          separate teaspoon or tablespoon entries.
        * unit "tin"/"packet"/"bottle"/"slice"/"clove" - only where a standard size genuinely
          exists for this ingredient.
      Return an empty array rather than guessing. A wrong size produces a confidently wrong
      shopping list, whereas a missing one just leaves two amounts side by side, which is
      harmless.
    - displayUnit: the unit a shopper would rather see the total in, if it is not the
      baseUnit - "" (bare count) for countable produce so the list says "6" rather than
      "900 gram", "tin" for tinned goods. Requires a matching unitSizes entry to work, so do
      not set it without one. null for anything bought by weight or volume.

    Other rules:
    - Preserve the original order of the ingredients.
    - Ignore anything that isn't part of the ingredient list or method (navigation, ads, comments,
      related recipes, etc), if this looks like a full scraped page rather than a plain list.
  `;
}

// Snaps a parsed ingredient name to an existing canonical ingredient (case
// insensitive exact match) as a cheap, deterministic safety net on top of the
// prompt's own instruction to reuse known names, so near-identical wording
// doesn't silently fragment into a duplicate ingredient. Applied here, inside
// extractRecipe, rather than by each caller, so no Import Source can skip it.
function matchCanonicalIngredient(name, knownIngredientNames) {
  const normalized = (name || '').trim().toLowerCase();
  const match = knownIngredientNames.find((known) => known.toLowerCase() === normalized);
  return match || (name || '').trim();
}

function buildRequestInput(input, instructions) {
  if (input.type === 'image') {
    return [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: instructions },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${input.base64}`, detail: 'high' },
        ],
      },
    ];
  }

  return `${instructions}\n\nRecipe content:\n${input.text}`;
}

export async function extractRecipe({ input, knownIngredients = [], knownUnits = [] }) {
  const instructions = buildInstructions(knownIngredients, knownUnits);

  const response = await openai.responses.create({
    model: EXTRACTION_MODEL,
    input: buildRequestInput(input, instructions),
    text: {
      format: {
        type: 'json_schema',
        name: 'recipe',
        schema: SCHEMA,
        strict: true,
      },
    },
  });

  const { isVegetarian, ingredients, newIngredients = [], ...rest } = JSON.parse(response.output_text);

  // Attach the proposed catalog metadata to the ingredient it describes, so
  // callers carry one shape through to the save payload rather than a parallel
  // list they have to join up themselves.
  const proposals = new Map(newIngredients.map((n) => [n.name, n]));

  return {
    ...rest,
    ingredients: ingredients.map((ingredient) => {
      const name = matchCanonicalIngredient(ingredient.name, knownIngredients);
      const proposal = proposals.get(ingredient.name);
      // A name that matched an existing ingredient is by definition already
      // known, so any proposal for it is dropped - the model was told not to,
      // but this makes it impossible rather than merely instructed.
      if (!proposal || name !== ingredient.name) {
        return { ...ingredient, name };
      }
      return {
        ...ingredient,
        name,
        ...(proposal.baseUnit ? { baseUnit: proposal.baseUnit } : {}),
        ...(proposal.displayUnit !== null ? { displayUnit: proposal.displayUnit } : {}),
        // Defensive: a malformed proposal must not throw out of extractRecipe and
        // take the whole import down with it. Classification is a bonus; losing it
        // is a missed improvement, losing the recipe is a failure.
        ...(proposal.unitSizes?.length
          ? { unitSizes: Object.fromEntries(proposal.unitSizes.map(({ unit, size }) => [unit, size])) }
          : {}),
      };
    }),
    tags: isVegetarian ? ['Vegetarian'] : [],
  };
}
