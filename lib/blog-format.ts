// Split out of lib/blog.ts deliberately. That module reads content/posts/ via
// node:fs, which is fine inside getStaticProps/getStaticPaths (server-only,
// tree-shaken out of the client bundle) but not fine here: both blog pages
// call formatPostDate directly in their JSX, so it has to run in the browser
// too, and `next build`'s client bundling fails outright if node:fs is
// reachable from there ("the chunking context does not support external
// modules"). Keeping this one function in a module with no fs/gray-matter/
// remark imports is what lets it ship to the browser at all.

// Shown identically on the listing page and a post's own page, whatever the
// reader's timezone. Pinned to UTC because `new Date('2026-09-06')` parses as
// UTC midnight, and formatting that in a reader's local zone can roll it back
// a day west of Greenwich - the date is editorial ("6 September 2026"), not a
// timestamp, so it should read the same everywhere.
export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
