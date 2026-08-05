import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn()
}));

// Imported transitively by the route, and constructs an OpenAI client at module
// load - which needs a key that no test should have. Nothing here gets as far
// as an extraction anyway.
vi.mock('../../lib/recipe-import/extract', () => ({
  extractRecipe: vi.fn()
}));

import { getStore } from '@netlify/blobs';
import handler from './recipe-image';

const mockedGetStore = getStore as unknown as Mock;

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
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  vi.stubEnv('NETLIFY_BLOB_STORE_TOKEN', 'token');
  vi.stubEnv('NETLIFY_SITE_ID', 'site');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  storeGet.mockReset();
  storeGet.mockResolvedValue(JSON.stringify(job));
  mockedGetStore.mockReturnValue({ get: storeGet, set: vi.fn() });
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
});
