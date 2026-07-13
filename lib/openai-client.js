import { OpenAI } from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

// Balanced-cost model used for text-based recipe extraction (ingredients, method).
// Photo extraction (recipe-image.mjs) still uses its own vision model and is unchanged.
export const EXTRACTION_MODEL = 'gpt-5.6-terra';
