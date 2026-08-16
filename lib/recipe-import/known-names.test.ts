import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKnownNames } from './known-names';

const ok = (rows: { name: string }[]) => ({ ok: true, json: async () => rows });

beforeEach(() => {
  // The direct path: an absolute NEXT_PUBLIC_API_HOST is what dev-full.sh sets
  // and is the signal that there is no Netlify edge in front (lib/api-host.ts),
  // so edgeApiHost declines and serverApiHost answers. The edge path has its own
  // group below.
  vi.stubEnv('API_HOST_INTERNAL', 'http://api.test');
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

    await expect(fetchKnownNames()).resolves.toEqual({
      knownIngredients: ['egg', 'thyme'],
      knownUnits: ['gram']
    });

    // Asserted as whole URLs, not suffixes. The host half is the point: a
    // regression that picked the wrong host would build a different URL here,
    // and a suffix assertion is satisfied by both.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/ingredients',
      'http://api.test/units'
    ]);
  });

  // Was "forwards the caller Authorization header", and the reversal is the
  // point of follow-ups.md #51 rather than a loosening. Both routes are now
  // exempt from the API's auth gate, and a shared CDN will not reliably store a
  // response to a request carrying Authorization - so a token here would turn
  // the s-maxage on both routes into decoration and leave every import paying
  // for the Atlantic crossing.
  it('sends no Authorization header, so the response stays cacheable', async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKnownNames();

    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).not.toHaveProperty('Authorization');
    }
  });

  // The blank-named count Unit is a real row (a bare "3 tomatoes"), but a unit
  // word the model could pick is exactly what it is not.
  it('drops the blank-named count Unit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/units') ? ok([{ name: '' }, { name: 'gram' }]) : ok([{ name: 'egg' }])
    ));

    const { knownUnits } = await fetchKnownNames();
    expect(knownUnits).toEqual(['gram']);
  });

  // Canonicalisation is a bonus; the recipe is not. Every failure below has to
  // degrade to an empty list rather than reject, or a flaky lookup takes the
  // user's import down with it.
  it('returns empty lists rather than throwing when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    await expect(fetchKnownNames()).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
  });

  it('returns empty lists rather than throwing when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(fetchKnownNames()).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
  });

  it('returns empty lists when no API host is configured', async () => {
    vi.stubEnv('API_HOST_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchKnownNames()).resolves.toEqual({ knownIngredients: [], knownUnits: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The production shape, and the whole of the change: a relative
// NEXT_PUBLIC_API_HOST means Netlify is in front, so the call goes to the
// site's own hostname and meets a PoP near the function instead of crossing to
// Frankfurt.
describe('fetchKnownNames through the edge', () => {
  it('calls the site hostname rather than the Fly origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');
    vi.stubEnv('API_HOST_INTERNAL', 'https://big-shop-api.fly.dev/api/bigshop');
    vi.stubEnv('URL', 'https://www.bigshop.life');
    const fetchMock = vi.fn(async (_url: string) => ok([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKnownNames();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://www.bigshop.life/api/bigshop/ingredients',
      'https://www.bigshop.life/api/bigshop/units'
    ]);
  });

  // A deploy preview must read its own edge, not production's. NEXT_PUBLIC_HOST
  // is inlined at build time and says www.bigshop.life on every deploy - the
  // same trap docs/deploy-previews.md describes for Auth0 redirects - so a
  // preview would otherwise verify nothing about itself.
  it('prefers the deploy URL, so a preview reads its own edge', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');
    vi.stubEnv('URL', 'https://www.bigshop.life');
    vi.stubEnv('DEPLOY_URL', 'https://deploy-preview-102--big-shop.netlify.app');
    const fetchMock = vi.fn(async (_url: string) => ok([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKnownNames();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://deploy-preview-102--big-shop.netlify.app/api/bigshop/ingredients',
      'https://deploy-preview-102--big-shop.netlify.app/api/bigshop/units'
    ]);
  });

  // The one misconfiguration that would be silent: no Netlify runtime variable
  // set, a relative path, and nothing to make it absolute. Falling through to
  // serverApiHost keeps the import working on the direct origin rather than
  // fetching a relative URL, which throws in Node.
  it('falls back to the direct origin when there is no site origin to use', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_HOST', '/api/bigshop');
    vi.stubEnv('API_HOST_INTERNAL', 'https://big-shop-api.fly.dev/api/bigshop');
    vi.stubEnv('URL', '');
    vi.stubEnv('DEPLOY_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HOST', '');
    const fetchMock = vi.fn(async (_url: string) => ok([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKnownNames();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://big-shop-api.fly.dev/api/bigshop/ingredients',
      'https://big-shop-api.fly.dev/api/bigshop/units'
    ]);
  });
});
