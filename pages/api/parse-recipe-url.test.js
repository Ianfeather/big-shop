import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/extract-recipe-ingredients', () => ({
  extractRecipeIngredients: vi.fn()
}));
vi.mock('../../lib/extract-recipe-method', () => ({
  extractRecipeMethod: vi.fn()
}));

import { extractRecipeIngredients } from '../../lib/extract-recipe-ingredients';
import { extractRecipeMethod } from '../../lib/extract-recipe-method';
import handler from './parse-recipe-url';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  extractRecipeIngredients.mockReset();
  extractRecipeMethod.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parse-recipe-url handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('requires a url', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'url is required' });
  });

  it('rejects a malformed url', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { url: 'not a url' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'url is not a valid URL' });
  });

  it('fetches the page, strips noise, and combines ingredients + method results', async () => {
    const html = '<html><head><script>bad()</script></head><body><p>2 eggs</p></body></html>';
    fetch.mockResolvedValue({ text: async () => html });
    extractRecipeIngredients.mockResolvedValue({ name: 'Omelette', isVegetarian: true, ingredients: [{ name: 'egg', quantity: '2', unit: '' }] });
    extractRecipeMethod.mockResolvedValue({ method: '1. Beat eggs' });
    const res = mockRes();

    await handler({ method: 'POST', body: { url: 'https://example.com/recipe' } }, res);

    expect(fetch).toHaveBeenCalledWith('https://example.com/recipe');
    const [{ text }] = extractRecipeIngredients.mock.calls[0];
    expect(text).not.toContain('<script>');
    expect(text).toContain('2 eggs');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      name: 'Omelette',
      isVegetarian: true,
      ingredients: [{ name: 'egg', quantity: '2', unit: '' }],
      method: '1. Beat eggs'
    });
  });

  it('returns a 500 with the error message when fetching/extraction fails', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    const res = mockRes();

    await handler({ method: 'POST', body: { url: 'https://example.com/recipe' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'network down' });
  });
});
