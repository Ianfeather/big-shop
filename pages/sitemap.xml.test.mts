import { describe, it, expect, vi } from 'vitest';
import type { GetServerSidePropsContext } from 'next';

// Not a page a browser navigates to via router.route in the usual sense -
// getServerSideProps writes straight to the response - so this tests the
// exported function directly rather than rendering the component (which
// deliberately renders nothing; see sitemap.xml.tsx).

vi.mock('../lib/blog', () => ({
  getAllPosts: vi.fn(() => [
    { slug: 'why-we-built-bigshop', title: 'Why we built Big Shop', date: '2026-09-06', description: 'x' },
  ]),
}));

import { getServerSideProps } from './sitemap.xml';

function fakeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    write: (chunk: string) => { chunks.push(chunk); },
    end: () => {},
    headers,
    body: () => chunks.join(''),
  };
}

describe('the sitemap', () => {
  it('lists the public pages and every post, as absolute URLs, with XML content type', async () => {
    const res = fakeRes();
    const ctx = { res } as unknown as GetServerSidePropsContext;

    await getServerSideProps(ctx);

    expect(res.headers['Content-Type']).toBe('text/xml');
    const xml = res.body();
    expect(xml).toContain('<loc>https://www.bigshop.life/</loc>');
    expect(xml).toContain('<loc>https://www.bigshop.life/privacy</loc>');
    expect(xml).toContain('<loc>https://www.bigshop.life/support</loc>');
    expect(xml).toContain('<loc>https://www.bigshop.life/about-bigshop</loc>');
    expect(xml).toContain('<loc>https://www.bigshop.life/about-bigshop/why-we-built-bigshop</loc>');
    expect(xml).toContain('<lastmod>2026-09-06</lastmod>');
  });
});
