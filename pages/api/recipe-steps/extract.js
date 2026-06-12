import { parse } from 'node-html-parser';
import OpenAI from 'openai';
import getBackend from '../third-parties';
import defaultScraper from '../third-parties/default';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXTRACTION_PROMPT = `You are a cooking assistant. Parse the following recipe method into discrete cooking steps.

Rules:
- Split any step that describes two simultaneous actions into two separate sequential steps
- Estimate a duration in minutes where you can reasonably do so; use null if uncertain
- Classify each step as: prep (chopping/measuring/mixing), cook (active heat requiring attention), passive (oven/resting/marinating — no attention needed), or other
- Return only a JSON array, no explanation

Schema: [{ "stepNumber": 1, "instruction": "...", "durationMinutes": 10, "stepType": "prep" }]

Method:
`;

async function extractFromUrl(remoteUrl) {
  try {
    const { hostname } = new URL(remoteUrl);
    const html = await (await fetch(remoteUrl)).text();
    const document = parse(html);
    const backend = getBackend(hostname);

    // Try named scraper's getSteps first (site-specific override), then default (JSON-LD)
    if (typeof backend.getSteps === 'function') {
      const steps = backend.getSteps(document);
      if (steps && steps.length > 0) return steps;
    }

    // Always try the default JSON-LD path as fallback — it works for most sites
    if (backend !== defaultScraper) {
      const steps = defaultScraper.getSteps(document);
      if (steps && steps.length > 0) return steps;
    }

    return null;
  } catch {
    return null;
  }
}

async function extractFromMethod(method) {
  if (!method?.trim()) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: EXTRACTION_PROMPT + method }],
      temperature: 0.2,
    });
    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const steps = JSON.parse(content);
    return Array.isArray(steps) ? steps : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { remoteUrl, method } = req.body;

  // Priority 1: scrape original source
  if (remoteUrl) {
    const steps = await extractFromUrl(remoteUrl);
    if (steps && steps.length > 0) {
      return res.status(200).json({ steps, source: 'scraper' });
    }
  }

  // Priority 2: AI extraction from method text
  if (method) {
    const steps = await extractFromMethod(method);
    if (steps && steps.length > 0) {
      return res.status(200).json({ steps, source: 'ai' });
    }
  }

  return res.status(200).json({ steps: [], source: 'none' });
}
