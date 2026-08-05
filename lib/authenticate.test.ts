import type { NextApiRequest } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticateAccount } from './authenticate';

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as NextApiRequest;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticateAccount', () => {
  it('resolves the caller to their Account', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 7, users: [] }) }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticateAccount(req({ authorization: 'Bearer good' }))).resolves.toEqual({
      ok: true,
      account: { id: 7 }
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/account', {
      headers: { Authorization: 'Bearer good' }
    });
  });

  it('rejects a request with no Authorization header without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticateAccount(req())).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Authentication required'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token the API refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));

    await expect(authenticateAccount(req({ authorization: 'Bearer forged' }))).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Authentication required'
    });
  });

  // A gate that fails open is not a gate - unlike fetchKnownNames, which
  // deliberately degrades to an empty list on exactly these failures.
  it('fails closed when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(authenticateAccount(req({ authorization: 'Bearer good' }))).resolves.toMatchObject({
      ok: false,
      status: 500
    });
  });

  it('fails closed when NEXT_PUBLIC_API_HOST is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticateAccount(req({ authorization: 'Bearer good' }))).resolves.toMatchObject({
      ok: false,
      status: 500
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the API answers without an account id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ users: [] }) })));

    await expect(authenticateAccount(req({ authorization: 'Bearer good' }))).resolves.toMatchObject({
      ok: false,
      status: 500
    });
  });
});
