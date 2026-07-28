import type { NextApiRequest } from 'next';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKnownNames } from './known-names';

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as NextApiRequest;

const ok = (rows: { name: string }[]) => ({ ok: true, json: async () => rows });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchKnownNames', () => {
  it('reads both lists from the Go API', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/ingredients') ? ok([{ name: 'egg' }, { name: 'thyme' }]) : ok([{ name: 'gram' }])
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchKnownNames(req())).resolves.toEqual({
      knownIngredients: ['egg', 'thyme'],
      knownUnits: ['gram']
    });
  });

  it('forwards the caller Authorization header to the Go API', async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKnownNames(req({ authorization: 'Bearer abc123' }));

    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toEqual({ Authorization: 'Bearer abc123' });
    }
  });

  // The blank-named count Unit is a real row (a bare "3 tomatoes"), but a unit
  // word the model could pick is exactly what it is not.
  it('drops the blank-named count Unit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/units') ? ok([{ name: '' }, { name: 'gram' }]) : ok([{ name: 'egg' }])
    ));

    const { knownUnits } = await fetchKnownNames(req());
    expect(knownUnits).toEqual(['gram']);
  });

  // Canonicalisation is a bonus; the recipe is not. Every failure below has to
  // degrade to an empty list rather than reject, or a flaky lookup takes the
  // user's import down with it.
  it('returns empty lists rather than throwing when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    await expect(fetchKnownNames(req())).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
  });

  it('returns empty lists rather than throwing when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(fetchKnownNames(req())).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
  });

  it('returns empty lists when NEXT_PUBLIC_API_HOST is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchKnownNames(req())).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
