import { extractRecipe } from '../../lib/recipe-import/extract';
import { htmlToInput } from '../../lib/recipe-import/url';

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
    const result = await extractRecipe({
      input: htmlToInput(html),
      knownIngredients,
      knownUnits,
    });

    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
