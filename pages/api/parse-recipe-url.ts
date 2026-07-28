import type { NextApiRequest, NextApiResponse } from 'next';
import { extractRecipe } from '../../lib/recipe-import/extract';
import { fetchKnownNames } from '../../lib/recipe-import/known-names';
import { htmlToInput } from '../../lib/recipe-import/url';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

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
    // Read from the database rather than taken from the request body - see
    // lib/recipe-import/known-names.ts for why the client is no longer asked.
    const { knownIngredients, knownUnits } = await fetchKnownNames(req);
    const result = await extractRecipe({
      input: htmlToInput(html),
      knownIngredients,
      knownUnits,
    });

    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
