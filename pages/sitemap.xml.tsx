import type { GetServerSideProps } from 'next';
import { getAllPosts } from '../lib/blog';

// A hand-rolled sitemap rather than a dependency (next-sitemap etc.): the
// site's public surface is small and already known - the marketing pages and
// the /about-bigshop section - so a build-time generator would be one more
// thing to keep in sync with pages/_app.tsx's publicRoutes. This reads the
// same getAllPosts() the blog pages do, so a new markdown file appears here
// with no second edit.
//
// This has to be a real page at the site root rather than a pages/api/ route:
// the sitemap protocol (sitemaps.org) restricts a sitemap file to URLs at or
// below its own path, so one served from /api/sitemap.xml could only list
// /api/* URLs.
//
// The classic Pages Router pattern for a non-HTML response: getServerSideProps
// writes the XML directly to `res` and ends it, so the page component below
// never actually renders - Next skips rendering once the response is already
// finished.

const SITE_URL = process.env.NEXT_PUBLIC_HOST ?? 'https://www.bigshop.life';

// The pages/_app.tsx publicRoutes an unauthenticated visitor - and therefore
// a crawler - can actually see. Kept as a short literal list rather than
// derived from publicRoutes itself: that array holds route *templates*
// ('/', '/privacy', ...) which happen to already be resolved paths here, but
// deriving one from the other would couple a routing concern to an SEO one
// for no real saving.
const STATIC_PATHS = ['/', '/privacy', '/support', '/about-bigshop'];

function urlEntry(loc: string, lastmod?: string): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return `  <url>\n    <loc>${loc}</loc>${lastmodTag}\n  </url>`;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const posts = getAllPosts();

  const urls = [
    ...STATIC_PATHS.map(path => urlEntry(`${SITE_URL}${path}`)),
    ...posts.map(post => urlEntry(`${SITE_URL}/about-bigshop/${post.slug}`, post.date)),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') +
    '\n</urlset>\n';

  res.setHeader('Content-Type', 'text/xml');
  res.write(xml);
  res.end();

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
