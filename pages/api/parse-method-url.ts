import type { NextApiRequest, NextApiResponse } from 'next';
import { extractMethod } from '../../lib/recipe-import/extract';
import { htmlToInput } from '../../lib/recipe-import/url';
import { authenticateAccount } from '../../lib/authenticate';
import { withTelemetry } from '../../lib/telemetry/api-route';
import { recordAccount, recordError } from '../../lib/telemetry/span';
import { recordImportOutcome } from '../../lib/telemetry/metrics';

// Method Import from a link: an existing Recipe with an empty Method, filled in
// from the page it came from.
//
// Separate from /api/parse-recipe-url rather than a mode on it, because the two
// disagree about nearly everything that route does: this one wants no canonical
// Ingredient/Unit names (it returns prose), keeps a page with no ingredients at
// all - a method-only page is a perfectly good source here and a hard failure
// there - and fails on an empty *method* instead.
//
// It does authenticate, which /api/parse-recipe-url still does not. Nothing but
// a token stands between an anonymous request and an OpenAI call on this app's
// quota, and there is no reason for a new route to inherit that.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateAccount(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }
  recordAccount(auth.account.id);

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
    const { method } = await extractMethod({ input: htmlToInput(html) });

    // Same reasoning as follow-ups.md #40: silently handing back an empty
    // string looks like the page had no method, rather than like this app
    // failed to read one. The cook is one keystroke from typing it themselves,
    // so say which it was.
    if (!method?.trim()) {
      recordImportOutcome('method-url', 'empty');
      return res.status(422).json({
        error: 'No method could be read from that page. Try another link, a photo, or type it in below.',
      });
    }

    recordImportOutcome('method-url', 'success');
    res.status(200).json({ method });
  } catch (e) {
    recordImportOutcome('method-url', 'error');
    recordError(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export default withTelemetry('/api/parse-method-url', handler);
