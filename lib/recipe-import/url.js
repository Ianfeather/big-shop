import { parse } from 'node-html-parser';

// Keep the LLM's input bounded - a full recipe page can be hundreds of KB, almost all of it
// script/style/nav noise that costs tokens without adding signal.
const MAX_TEXT_LENGTH = 60000;
const NOISE_SELECTOR = 'script, style, svg, noscript, iframe, link, meta, head';

// htmlToInput turns a fetched recipe page into the text the extractor reads.
//
// It prefers the page's schema.org JSON-LD Recipe, and falls back to the page's
// visible text. Both of those are deliberate, and both were bugs (follow-ups.md
// #40): the old version stripped every <script> - which is where the JSON-LD
// lives - and then truncated the remaining *markup* at 60,000 characters. On a
// modern recipe site that markup is mostly class attributes, so BBC Good Food's
// chicken tzatziki wraps put its ingredients at character 108,000 of 165,000 and
// the model never saw them. It dutifully returned an empty ingredients array for
// a page whose ingredients were right there in a JSON blob.
//
// Visible text rather than markup is the fix for the general case: the same page
// is 6,000 characters of text, so the limit stops being something a real page
// can hit. JSON-LD, where a site publishes it, is better still - it is the
// recipe already separated from the page, with no nav or related-recipe
// sidebars for the model to mistake for ingredients.
export function htmlToInput(html) {
  const document = parse(html);

  const structured = recipeFromJsonLd(document);
  if (structured) {
    return { type: 'text', text: structured.slice(0, MAX_TEXT_LENGTH) };
  }

  // Read before the <head> goes: the title is often the only place the recipe's
  // name appears as plain text.
  const title = document.querySelector('title')?.text?.trim();
  document.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
  const text = [title, document.structuredText].filter(Boolean).join('\n');

  return { type: 'text', text: text.slice(0, MAX_TEXT_LENGTH) };
}

// Renders the page's schema.org Recipe as plain text, or null when the page has
// none - or has one carrying no ingredients, which is no better than the page
// text and worth falling back from rather than trusting.
function recipeFromJsonLd(document) {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed;
    try {
      parsed = JSON.parse(script.text);
    } catch {
      // A single malformed block is normal on a page carrying several; it must
      // not take the whole import down when another block holds the recipe.
      continue;
    }

    for (const recipe of recipeNodes(parsed)) {
      const text = recipeToText(recipe);
      if (text) return text;
    }
  }

  return null;
}

// Finds the Recipe nodes in a JSON-LD block. Sites nest them every way the spec
// allows: a bare object, a top-level array, or a `@graph` of every entity on the
// page, with `@type` itself sometimes an array.
function recipeNodes(value) {
  if (Array.isArray(value)) return value.flatMap(recipeNodes);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value['@graph'])) return recipeNodes(value['@graph']);

  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  return types.includes('Recipe') ? [value] : [];
}

function recipeToText(recipe) {
  const ingredients = toArray(recipe.recipeIngredient)
    .filter((line) => typeof line === 'string')
    .map(plainText)
    .filter(Boolean);

  if (!ingredients.length) return null;

  const steps = instructionSteps(recipe.recipeInstructions);

  return [
    recipe.name ? `Name: ${plainText(recipe.name)}` : '',
    recipe.recipeYield ? `Serves: ${toArray(recipe.recipeYield).join(', ')}` : '',
    'Ingredients:',
    ...ingredients.map((line) => `- ${line}`),
    ...(steps.length ? ['Method:', ...steps.map((step, i) => `${i + 1}. ${step}`)] : []),
  ]
    .filter(Boolean)
    .join('\n');
}

// recipeInstructions is the least consistently modelled field in the whole
// schema: a single prose string, an array of strings, an array of HowToStep
// objects, or HowToSections each wrapping their own list of steps.
function instructionSteps(value) {
  if (typeof value === 'string') return [plainText(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(instructionSteps);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.itemListElement)) return instructionSteps(value.itemListElement);

  return typeof value.text === 'string' ? [plainText(value.text)].filter(Boolean) : [];
}

// Some sites put markup inside their JSON-LD strings. It reaches the model as
// tags otherwise, which is exactly the noise the structured path exists to avoid.
function plainText(value) {
  const text = String(value ?? '');
  return (text.includes('<') ? parse(text).structuredText : text).replace(/\s+/g, ' ').trim();
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
