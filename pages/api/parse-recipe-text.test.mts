import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('../../lib/recipe-import/extract', () => ({
  extractRecipe: vi.fn()
}));

vi.mock('../../lib/recipe-import/known-names', () => ({
  fetchKnownNames: vi.fn()
}));

import { extractRecipe } from '../../lib/recipe-import/extract';
import { fetchKnownNames } from '../../lib/recipe-import/known-names';
import handler from './parse-recipe-text';

const mockedExtractRecipe = extractRecipe as unknown as Mock;
const mockedFetchKnownNames = fetchKnownNames as unknown as Mock;

function mockReq(overrides: Partial<NextApiRequest>): NextApiRequest {
  return overrides as NextApiRequest;
}

function mockRes(): NextApiResponse {
  const res: Partial<NextApiResponse> = {};
  res.status = vi.fn(() => res) as unknown as NextApiResponse['status'];
  res.json = vi.fn(() => res) as unknown as NextApiResponse['json'];
  return res as NextApiResponse;
}

beforeEach(() => {
  mockedExtractRecipe.mockReset();
  mockedFetchKnownNames.mockReset();
  mockedFetchKnownNames.mockResolvedValue({ knownIngredients: ['egg'], knownUnits: ['gram'] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parse-recipe-text handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('requires non-blank text', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { text: '   ' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'text is required' });
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it('extracts and returns ingredients on success', async () => {
    mockedExtractRecipe.mockResolvedValue({
      name: '',
      ingredients: [{ name: 'egg', quantity: '2', unit: '' }],
      method: '',
      tags: []
    });
    const res = mockRes();

    // knownIngredients/knownUnits in the body are deliberately wrong here: the
    // route must ignore whatever the client sends and use what it reads from
    // the database, which is the whole point of moving the lookup server-side.
    await handler(mockReq({
      method: 'POST',
      body: { text: '2 eggs', knownIngredients: ['stale'], knownUnits: ['stale'] }
    }), res);

    expect(extractRecipe).toHaveBeenCalledWith({
      // `source` is what tells the extractor this is a list the cook wrote out
      // rather than a scraped page, which is the difference between a prompt
      // that keeps every line and one that may drop some as a title or as
      // pantry noise (lib/recipe-import/extract.test.ts).
      input: { type: 'text', source: 'ingredient-list', text: '2 eggs' },
      knownIngredients: ['egg'],
      knownUnits: ['gram']
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ingredients: [{ name: 'egg', quantity: '2', unit: '' }] });
  });

  it('returns a 500 with the error message when extraction fails', async () => {
    mockedExtractRecipe.mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { text: '2 eggs' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
  });
});
