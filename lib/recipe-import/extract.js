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
          pantryStaple: { type: 'boolean' },
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
        required: ['name', 'baseUnit', 'displayUnit', 'pantryStaple', 'unitSizes'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'isVegetarian', 'ingredients', 'method', 'newIngredients'],
  additionalProperties: false,
};

// Just the method, for a Recipe that already exists and is only missing its
// instructions (see extractMethod below). Nothing else is asked for: the cook is
// filling one field on a Recipe they have already named and whose ingredients
// they have already got, and a name or an ingredient list extracted here would
// have nowhere to go.
const METHOD_SCHEMA = {
  type: 'object',
  properties: {
    method: { type: 'string' },
  },
  required: ['method'],
  additionalProperties: false,
};

const DEFAULT_UNITS = 'bottle,clove,gram,kilogram,litre,millilitre,packet,pinch,slice,tablespoon,teaspoon,tin';

// How a method should come back, wherever it is extracted from. Shared by the
// whole-recipe prompt and the method-only one so the two can't drift into
// formatting the same field differently - components/recipe/index.tsx parses
// "1. ", "2. " back out of this text to render numbered steps.
const METHOD_FORMAT_RULES = `formatted in markdown as clearly as possible. Each
      instruction should be its own numbered line, e.g. "1. Preheat the oven.\\n2. Mix the
      ingredients.\\n3. Bake for 30 minutes." If a step is itself a list of items, format it as a
      nested markdown list. The method must NOT use double quotes (") at any point - replace them
      with a single quote if needed, or omit them.`;

// A hand-written ingredient list and a scraped page are read very differently,
// and conflating them cost the cook one of six ingredients on a single paste
// (see extract.test.ts). A page has a title, navigation and a method to tell
// apart from the ingredients. A list typed into the Ingredients box has none of
// that: it is an explicit enumeration, every line of it wanted, and the caller
// keeps only `ingredients` - so a line read as the title is gone with nothing
// shown to the cook.
function buildFieldRules(source) {
  if (source === 'ingredient-list') {
    return `
    Read the following ingredient list. The cook typed or pasted it straight into an "add
    ingredients" box, so EVERY non-blank line is an ingredient - there is no title, no
    navigation, and no method anywhere in it. Extract:

    - name: always an empty string.
    - isVegetarian: true only if none of the ingredients are meat, poultry, fish, or a
      meat/fish-derived product (e.g. gelatine, fish sauce, chicken stock).
    - ingredients: an array of {name, quantity, unit}, with one entry for every non-blank line.
      A line that also reads like a recipe's title or a component of one is still an ingredient
      when it carries an amount - "Jerk marinade: 120ml" is 120 millilitres of jerk marinade,
      not the name of the dish. The only lines to skip are bare section headings carrying no
      amount at all (e.g. "For the sauce:").
    - method: always an empty string.
`;
  }

  return `
    Read the following recipe content - it is text/HTML scraped from a recipe web page, or an
    attached photo of a recipe (e.g. from a cookbook) - and extract:

    - name: the recipe's name/title. If this is just an ingredient list with no title, use
      an empty string.
    - isVegetarian: true only if none of the ingredients are meat, poultry, fish, or a
      meat/fish-derived product (e.g. gelatine, fish sauce, chicken stock).
    - ingredients: an array of {name, quantity, unit}.
    - method: the cooking method/instructions, ${METHOD_FORMAT_RULES} If no method/instructions
      can be found (e.g. a bare ingredient list), return an empty string.
`;
}

function buildInstructions(knownIngredients, knownUnits, source) {
  return `${buildFieldRules(source)}
    These ingredients will later be combined across multiple recipes into a single shopping list,
    so consistent naming and units matter more than anything else - two ingredients that are the
    same thing must always end up with the exact same name and unit, or they won't combine.

    Keep every ingredient:
    - Never leave an ingredient out because it seems too ordinary to be worth buying. Salt,
      pepper, cooking oil, flour, butter and sugar go in the list like anything else, at whatever
      amount the recipe gives. The app groups store-cupboard basics together on the shopping list
      itself, where the shopper can still see them and open them up, so they stay out of the way
      without the recipe being wrong about what is in it. Mark them with pantryStaple below
      rather than by omitting them.
    - This used to work the other way round - those six were dropped outright at a small enough
      amount - and it was a mistake: a missing ingredient looks exactly like a failed extraction,
      and the cook has no way to tell which it was.

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
    - pantryStaple: true for a near-universal store-cupboard basic the shopper almost certainly
      already has open: salt, pepper, cooking oils (olive, vegetable, sunflower, rapeseed),
      flour, butter, and sugar. False for everything else, however common it looks - garlic,
      onion, stock, tinned tomatoes, spices and dried herbs are all things a household runs out
      of and has to replace. An oil bought for one dish's flavour (sesame, chilli, truffle) is
      not a cooking oil, so false. When unsure, false: a staple wrongly flagged is tucked into a
      collapsed group where it is easily missed, while an ordinary ingredient wrongly left out
      of the group is just one more line on the list.
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
    - Preserve the original order of the ingredients.${source === 'ingredient-list' ? '' : `
    - Ignore anything that isn't part of the ingredient list or method (navigation, ads, comments,
      related recipes, etc), if this looks like a full scraped page rather than a plain list.`}
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

  const heading = input.source === 'ingredient-list' ? 'Ingredient list' : 'Recipe content';
  return `${instructions}\n\n${heading}:\n${input.text}`;
}

export async function extractRecipe({ input, knownIngredients = [], knownUnits = [] }) {
  const instructions = buildInstructions(knownIngredients, knownUnits, input.source);

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
        // Only ever carried when true: the server's classification acts on true
        // alone, so a false is indistinguishable from no proposal and sending
        // it would just be noise in every save payload.
        ...(proposal.pantryStaple ? { pantryStaple: true } : {}),
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

// Method Import: a Recipe that already exists, with an empty Method, being
// filled in from a link or a photograph of the cookbook page it came from.
//
// Deliberately not extractRecipe with the other fields thrown away. Nothing here
// needs the canonical Ingredient and Unit lists, which are the expensive part of
// the whole-recipe prompt in both tokens and a round trip to the database, and
// asking for ingredients we would then discard invites the model to spend its
// attention on them. It also cannot go wrong in the way the full import can: no
// ingredient can be renamed, dropped, or given a wrong unit size by an
// extraction that only ever returns prose.
export async function extractMethod({ input }) {
  const instructions = `
    Read the following recipe content - it is text/HTML scraped from a recipe web page, or an
    attached photo of a recipe (e.g. from a cookbook) - and extract ONLY the cooking method.

    - method: the cooking method/instructions, ${METHOD_FORMAT_RULES}
    - Ignore everything that is not part of the instructions: the recipe's title, its ingredient
      list, serving sizes, and - if this looks like a full scraped page rather than a plain recipe -
      navigation, ads, comments and related recipes.
    - Do not invent steps. If the content carries no method/instructions at all, return an empty
      string; the caller tells the cook the page had none, which is far better than a plausible
      method nobody wrote.
  `;

  const response = await openai.responses.create({
    model: EXTRACTION_MODEL,
    input: buildRequestInput(input, instructions),
    text: {
      format: {
        type: 'json_schema',
        name: 'method',
        schema: METHOD_SCHEMA,
        strict: true,
      },
    },
  });

  const { method } = JSON.parse(response.output_text);
  return { method: method || '' };
}
