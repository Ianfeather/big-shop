import { extractRecipeIngredients } from '../../lib/extract-recipe-ingredients';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, knownIngredients = [], knownUnits = [] } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const { ingredients } = await extractRecipeIngredients({ text, knownIngredients, knownUnits });
    res.status(200).json({ ingredients });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
