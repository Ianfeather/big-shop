import { parse } from 'node-html-parser';
import { extractRecipeIngredients } from '../../lib/extract-recipe-ingredients';
import { extractRecipeMethod } from '../../lib/extract-recipe-method';

// Keep the LLM's input bounded - a full recipe page can be hundreds of KB, almost all of it
// script/style/nav noise that costs tokens without adding signal.
const MAX_HTML_LENGTH = 60000;
const NOISE_SELECTOR = 'script, style, svg, noscript, iframe, link, meta, head';

function extractTextFromHtml(html) {
  const document = parse(html);
  document.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
  return document.toString().slice(0, MAX_HTML_LENGTH);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, knownIngredients = [], knownUnits = [] } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'url is not a valid URL' });
  }

  try {
    const html = await (await fetch(url)).text();
    const text = extractTextFromHtml(html);

    const [ingredientsResult, methodResult] = await Promise.all([
      extractRecipeIngredients({ text, knownIngredients, knownUnits }),
      extractRecipeMethod({ text }),
    ]);

    res.status(200).json({
      name: ingredientsResult.name,
      isVegetarian: ingredientsResult.isVegetarian,
      ingredients: ingredientsResult.ingredients,
      method: methodResult.method,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
