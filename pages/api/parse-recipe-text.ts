import type { NextApiRequest, NextApiResponse } from 'next';
import { extractRecipe } from '../../lib/recipe-import/extract';
import { textToInput } from '../../lib/recipe-import/paste';
import { fetchKnownNames } from '../../lib/recipe-import/known-names';
import { withTelemetry } from '../../lib/telemetry/api-route';
import { recordError } from '../../lib/telemetry/span';
import { recordImportOutcome } from '../../lib/telemetry/metrics';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const { knownIngredients, knownUnits } = await fetchKnownNames();
    const { ingredients } = await extractRecipe({
      input: textToInput(text),
      knownIngredients,
      knownUnits,
    });
    // Unlike the URL Source, this one answers 200 with an empty list rather
    // than 422 - the caller pasted the ingredients itself, so an empty result
    // is a failed extraction of text the user can still see, not a page that
    // turned out to have nothing on it. Counted as `empty` all the same, so the
    // two Sources' extraction quality is comparable on one dashboard.
    recordImportOutcome('text', ingredients?.length ? 'success' : 'empty');
    res.status(200).json({ ingredients });
  } catch (e) {
    recordImportOutcome('text', 'error');
    recordError(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export default withTelemetry('/api/parse-recipe-text', handler);
