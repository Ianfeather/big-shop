import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn()
}));

// Imported transitively by the route, and constructs an OpenAI client at module
// load - which needs a key that no test should have. Both extractors are
// stubbed; the upload tests below assert on which of the two a request picked.
vi.mock('../../lib/recipe-import/extract', () => ({
  extractRecipe: vi.fn(),
  extractMethod: vi.fn()
}));

// The route reads the upload with formidable and the file off disk. Neither is
// what these tests are about, so both are stood in for - `parseFields` below is
// what a given test wants the form to have carried.
let parseFields: Record<string, string[]> = {};

vi.mock('formidable', () => ({
  default: () => ({
    parse: (_req: unknown, cb: (err: unknown, fields: unknown, files: unknown) => void) =>
      cb(null, parseFields, {
        image: [{ filepath: '/tmp/upload.jpg', mimetype: 'image/jpeg', size: 1024 }]
      })
  })
}));

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn(async () => Buffer.from('image-bytes')), unlink: vi.fn(async () => {}) }
}));

import { getStore } from '@netlify/blobs';
import { extractRecipe, extractMethod } from '../../lib/recipe-import/extract';
import handler from './recipe-image';

const mockedGetStore = getStore as unknown as Mock;
const mockedExtractRecipe = extractRecipe as unknown as Mock;
const mockedExtractMethod = extractMethod as unknown as Mock;

// One job, owned by account 7.
const job = { id: 'job-1', accountId: 7, status: 'completed', result: { name: 'Omelette' }, error: null };

function mockReq(overrides: Partial<NextApiRequest>): NextApiRequest {
  return { headers: {}, query: {}, ...overrides } as NextApiRequest;
}

function mockRes(): NextApiResponse {
  const res: Partial<NextApiResponse> = {};
  res.status = vi.fn(() => res) as unknown as NextApiResponse['status'];
  res.json = vi.fn(() => res) as unknown as NextApiResponse['json'];
  return res as NextApiResponse;
}

// Stands in for the Go API's GET /account, which is what lib/authenticate.ts
// asks whether a token is good.
const stubAccountApi = (account: { id: number } | null) =>
  vi.stubGlobal('fetch', vi.fn(async () =>
    account ? { ok: true, json: async () => account } : { ok: false, status: 401, json: async () => ({}) }
  ));

const storeGet = vi.fn();

beforeEach(() => {
  // This route authenticates through lib/authenticate.ts, which reads
  // API_HOST_INTERNAL server-side. NEXT_PUBLIC_API_HOST is stubbed relative
  // alongside it, matching the production shape, so a regression that reads the
  // browser variable fails here rather than passing via the fallback.
  vi.stubEnv('API_HOST_INTERNAL', 'http://api.test');
  vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');
  vi.stubEnv('NETLIFY_BLOB_STORE_TOKEN', 'token');
  vi.stubEnv('NETLIFY_SITE_ID', 'site');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  storeGet.mockReset();
  storeGet.mockResolvedValue(JSON.stringify(job));
  mockedGetStore.mockReturnValue({ get: storeGet, set: vi.fn() });
  parseFields = {};
  mockedExtractRecipe.mockReset();
  mockedExtractRecipe.mockResolvedValue({ name: 'Omelette', ingredients: [], method: '', tags: [] });
  mockedExtractMethod.mockReset();
  mockedExtractMethod.mockResolvedValue({ method: '1. Beat the eggs' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recipe-image job status (GET)', () => {
  it('rejects an unauthenticated caller without touching the job store', async () => {
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'GET', query: { jobId: 'job-1' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(storeGet).not.toHaveBeenCalled();
  });

  it('rejects a caller whose token the API refuses', async () => {
    stubAccountApi(null);
    const res = mockRes();

    await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer forged' }, query: { jobId: 'job-1' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(storeGet).not.toHaveBeenCalled();
  });

  // The job holds the entire contents of somebody's photographed recipe, and
  // the blob store is shared by every Account.
  it('does not hand a job to another Account, even with the right job id', async () => {
    stubAccountApi({ id: 9 });
    const res = mockRes();

    await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer good' }, query: { jobId: 'job-1' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Job not found' });
  });

  // Written before jobs carried an owner, so there is nothing to match on.
  it('does not hand over a job with no accountId', async () => {
    storeGet.mockResolvedValue(JSON.stringify({ id: 'job-1', status: 'completed', result: {} }));
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer good' }, query: { jobId: 'job-1' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns the job to the Account that created it', async () => {
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer good' }, query: { jobId: 'job-1' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(job);
  });

  it('still requires a job id', async () => {
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer good' }, query: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('recipe-image upload (POST)', () => {
  // An anonymous request should not reach the 5MB upload, let alone the
  // OpenAI call behind it.
  it('rejects an unauthenticated caller before parsing the form', async () => {
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'POST' }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('rejects a caller whose token the API refuses', async () => {
    stubAccountApi(null);
    const res = mockRes();

    await handler(mockReq({ method: 'POST', headers: { authorization: 'Bearer forged' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // Method Import shares this route with whole-recipe Photo Import, and `mode`
  // is the only thing that tells them apart. Get that wrong in either direction
  // and the failure is quiet: a method-only upload that runs the full
  // extraction returns a name, tags and an ingredient list for a Recipe that
  // already has all three, and a whole-recipe upload that runs the method-only
  // one returns a Recipe with no ingredients in it.
  it('runs the whole-recipe extraction when no mode is given', async () => {
    stubAccountApi({ id: 7 });
    const res = mockRes();

    await handler(mockReq({ method: 'POST', headers: { authorization: 'Bearer good' } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockedExtractRecipe).toHaveBeenCalled();
    expect(mockedExtractMethod).not.toHaveBeenCalled();
  });

  it('runs the method-only extraction for a mode=method upload', async () => {
    stubAccountApi({ id: 7 });
    parseFields = { mode: ['method'] };
    const res = mockRes();

    await handler(mockReq({ method: 'POST', headers: { authorization: 'Bearer good' } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockedExtractMethod).toHaveBeenCalled();
    expect(mockedExtractRecipe).not.toHaveBeenCalled();
  });

  // The canonical Ingredient/Unit lists cost two calls to the Go API and a good
  // chunk of the prompt, and a method-only extraction has no name or unit for
  // them to reconcile. Only the account check should reach the API.
  it('does not look up canonical names for a method-only upload', async () => {
    stubAccountApi({ id: 7 });
    parseFields = { mode: ['method'] };
    const res = mockRes();

    await handler(mockReq({ method: 'POST', headers: { authorization: 'Bearer good' } }), res);

    const paths = (fetch as unknown as Mock).mock.calls.map(([url]) => String(url));
    expect(paths).toEqual(['http://api.test/account']);
  });
});
