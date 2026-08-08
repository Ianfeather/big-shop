import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

vi.mock('../../lib/recipe-import/extract', () => ({
  extractMethod: vi.fn()
}));

vi.mock('../../lib/authenticate', () => ({
  authenticateAccount: vi.fn()
}));

import { extractMethod } from '../../lib/recipe-import/extract';
import { authenticateAccount } from '../../lib/authenticate';
import handler from './parse-method-url';

const mockedExtractMethod = extractMethod as unknown as Mock;
const mockedAuthenticate = authenticateAccount as unknown as Mock;

function mockReq(overrides: Partial<NextApiRequest>): NextApiRequest {
  return { headers: {}, ...overrides } as NextApiRequest;
}

function mockRes(): NextApiResponse {
  const res: Partial<NextApiResponse> = {};
  res.status = vi.fn(() => res) as unknown as NextApiResponse['status'];
  res.json = vi.fn(() => res) as unknown as NextApiResponse['json'];
  return res as NextApiResponse;
}

beforeEach(() => {
  mockedExtractMethod.mockReset();
  mockedAuthenticate.mockReset();
  mockedAuthenticate.mockResolvedValue({ ok: true, account: { id: 7 } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parse-method-url handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  // Unlike /api/parse-recipe-url, which is still open. Nothing else stands
  // between an anonymous caller and an OpenAI call on this app's quota.
  it('rejects an unauthenticated caller without fetching or extracting anything', async () => {
    mockedAuthenticate.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(mockedExtractMethod).not.toHaveBeenCalled();
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

  it('fetches the page and returns just the method', async () => {
    const html = '<html><head><script>bad()</script></head><body><p>1. Beat the eggs</p></body></html>';
    (fetch as unknown as Mock).mockResolvedValue({ text: async () => html });
    mockedExtractMethod.mockResolvedValue({ method: '1. Beat the eggs\n2. Fry them' });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(fetch).toHaveBeenCalledWith('https://example.com/recipe');
    const [{ input }] = mockedExtractMethod.mock.calls[0];
    expect(input.type).toBe('text');
    expect(input.text).not.toContain('<script>');
    expect(input.text).toContain('1. Beat the eggs');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ method: '1. Beat the eggs\n2. Fry them' });
  });

  // The whole-recipe route hands back a name and tags too. This one must not:
  // the Recipe being filled in already has both, and the cook did not ask for
  // them to be reconsidered.
  it('returns nothing but the method, whatever else the extraction carries', async () => {
    (fetch as unknown as Mock).mockResolvedValue({ text: async () => '<html><body>x</body></html>' });
    mockedExtractMethod.mockResolvedValue({ method: '1. Cook', name: 'Something else', tags: ['Vegetarian'] });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.json).toHaveBeenCalledWith({ method: '1. Cook' });
  });

  // Same reasoning as follow-ups.md #40: an empty string reaching the form looks
  // like the page had no method rather than like the extraction failed.
  it('fails visibly rather than returning an empty method', async () => {
    (fetch as unknown as Mock).mockResolvedValue({ text: async () => '<html><body>hello</body></html>' });
    mockedExtractMethod.mockResolvedValue({ method: '   ' });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'No method could be read from that page. Try another link, a photo, or type it in below.'
    });
  });

  // A page with a method and no ingredient list is a perfectly good source
  // here, where /api/parse-recipe-url treats exactly that as a hard failure.
  it('accepts a page carrying a method and no ingredients at all', async () => {
    (fetch as unknown as Mock).mockResolvedValue({ text: async () => '<html><body>1. Simmer</body></html>' });
    mockedExtractMethod.mockResolvedValue({ method: '1. Simmer for an hour' });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ method: '1. Simmer for an hour' });
  });

  it('returns a 500 with the error message when fetching/extraction fails', async () => {
    (fetch as unknown as Mock).mockRejectedValue(new Error('network down'));
    const res = mockRes();

    await handler(mockReq({ method: 'POST', body: { url: 'https://example.com/recipe' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'network down' });
  });
});
