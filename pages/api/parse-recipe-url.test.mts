import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

vi.mock('../../lib/recipe-import/extract', () => ({
  extractRecipe: vi.fn()
}));

import { extractRecipe } from '../../lib/recipe-import/extract';
import handler from './parse-recipe-url';

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
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parse-recipe-url handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('requires a url', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'url is required' });
  });

  it('rejects a malformed url', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { url: 'not a url' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'url is not a valid URL' });
  });

  it('fetches the page, strips noise, and returns the extraction result directly', async () => {
    const html = '<html><head><script>bad()</script></head><body><p>2 eggs</p></body></html>';
    (fetch as unknown as Mock).mockResolvedValue({ text: async () => html });
    mockedExtractRecipe.mockResolvedValue({
      name: 'Omelette',
      ingredients: [{ name: 'egg', quantity: '2', unit: '' }],
      method: '1. Beat eggs',
      tags: []
    });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(fetch).toHaveBeenCalledWith('https://example.com/recipe');
    const [{ input }] = mockedExtractRecipe.mock.calls[0];
    expect(input.type).toBe('text');
    expect(input.text).not.toContain('<script>');
    expect(input.text).toContain('2 eggs');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      name: 'Omelette',
      ingredients: [{ name: 'egg', quantity: '2', unit: '' }],
      method: '1. Beat eggs',
      tags: []
    });
  });

  it('returns a 500 with the error message when fetching/extraction fails', async () => {
    (fetch as unknown as Mock).mockRejectedValue(new Error('network down'));
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'network down' });
  });
});
