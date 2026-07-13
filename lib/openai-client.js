import { OpenAI } from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

// Model used for all Recipe Import extraction (lib/recipe-import/extract.js) - text and
// image input alike, via the Responses API's multimodal input support.
export const EXTRACTION_MODEL = 'gpt-5.6-terra';
