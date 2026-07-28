import type { NextApiRequest, NextApiResponse } from 'next';
import { extractRecipe } from '../../lib/recipe-import/extract';
import { textToInput } from '../../lib/recipe-import/paste';
import { fetchKnownNames } from '../../lib/recipe-import/known-names';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    // Read from the database rather than taken from the request body - see
    // lib/recipe-import/known-names.ts for why the client is no longer asked.
    const { knownIngredients, knownUnits } = await fetchKnownNames(req);
    const { ingredients } = await extractRecipe({
      input: textToInput(text),
      knownIngredients,
      knownUnits,
    });
    res.status(200).json({ ingredients });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
