import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/extract-recipe-ingredients', () => ({
  extractRecipeIngredients: vi.fn()
}));

import { extractRecipeIngredients } from '../../lib/extract-recipe-ingredients';
import handler from './parse-recipe-text';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  extractRecipeIngredients.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parse-recipe-text handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('requires non-blank text', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { text: '   ' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'text is required' });
    expect(extractRecipeIngredients).not.toHaveBeenCalled();
  });

  it('extracts and returns ingredients on success', async () => {
    extractRecipeIngredients.mockResolvedValue({ ingredients: [{ name: 'egg', quantity: '2', unit: '' }] });
    const res = mockRes();

    await handler({ method: 'POST', body: { text: '2 eggs', knownIngredients: ['egg'], knownUnits: [] } }, res);

    expect(extractRecipeIngredients).toHaveBeenCalledWith({ text: '2 eggs', knownIngredients: ['egg'], knownUnits: [] });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ingredients: [{ name: 'egg', quantity: '2', unit: '' }] });
  });

  it('returns a 500 with the error message when extraction fails', async () => {
    extractRecipeIngredients.mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await handler({ method: 'POST', body: { text: '2 eggs' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
  });
});
