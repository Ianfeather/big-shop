import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('../../lib/recipe-import/extract', () => ({
  extractRecipe: vi.fn()
}));

import { extractRecipe } from '../../lib/recipe-import/extract';
import handler from './parse-recipe-text';

const mockedExtractRecipe = extractRecipe as unknown as Mock;

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

    await handler(mockReq({ method: 'POST', body: { text: '2 eggs', knownIngredients: ['egg'], knownUnits: [] } }), res);

    expect(extractRecipe).toHaveBeenCalledWith({
      input: { type: 'text', text: '2 eggs' },
      knownIngredients: ['egg'],
      knownUnits: []
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
