import fs from 'fs';
import path from 'path';

// Serves the committed docs/openapi.yaml as-is, for pages/dev/api-docs.js to
// render. Dev-only, same as that page - see its comment for why.
export default function handler(req, res) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end();
  }

  const specPath = path.join(process.cwd(), 'docs', 'openapi.yaml');

  try {
    const spec = fs.readFileSync(specPath, 'utf8');
    res.setHeader('Content-Type', 'text/yaml');
    res.status(200).send(spec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not read docs/openapi.yaml - has it been generated? See technical-architecture.md.' });
  }
}
