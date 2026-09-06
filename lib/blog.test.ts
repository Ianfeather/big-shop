import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake in-memory content/posts/ directory, keyed by filename. Mocking
// node:fs rather than reading the repo's real content/ directory keeps this
// test independent of whatever posts actually exist - the real pipeline
// against the real post is exercised by the page tests and, ultimately, by
// `next build` itself.
const files: Record<string, string> = {};

vi.mock('node:fs', () => {
  const readdirSync = vi.fn(() => Object.keys(files));
  const readFileSync = vi.fn((path: string) => {
    const name = path.split('/').pop() as string;
    if (!(name in files)) throw new Error(`ENOENT: no such file, open '${path}'`);
    return files[name];
  });
  // Some dependency in the require chain (gray-matter's own internals) pulls
  // in `fs` via a default import under CJS/ESM interop, which Vitest's mock
  // needs a `default` key to satisfy on top of the named exports lib/blog.ts
  // itself uses.
  return { readdirSync, readFileSync, default: { readdirSync, readFileSync } };
});

// Vitest hoists vi.mock calls above imports, so this sees the mocked fs
// regardless of being written after it - same pattern as
// pages/recipes/add/slug.test.mts.
import { getAllSlugs, getAllPosts, getPost } from './blog';

function setFiles(next: Record<string, string>) {
  for (const key of Object.keys(files)) delete files[key];
  Object.assign(files, next);
}

const NEWER = `---
title: "Second post"
date: "2026-09-10"
description: "The second one."
---

Newer body.
`;

const OLDER = `---
title: "Why we built Big Shop"
date: "2026-09-06"
description: "The first one."
---

Some **body** text with a [link](/support).
`;

describe('the blog content pipeline', () => {
  beforeEach(() => {
    setFiles({ 'why-we-built-bigshop.md': OLDER, 'second-post.md': NEWER });
  });

  it('lists every markdown file as a slug', () => {
    expect(getAllSlugs().sort()).toEqual(['second-post', 'why-we-built-bigshop']);
  });

  it('lists posts newest first', () => {
    expect(getAllPosts().map(p => p.slug)).toEqual(['second-post', 'why-we-built-bigshop']);
  });

  it('reads frontmatter without rendering the body', () => {
    const [post] = getAllPosts();
    expect(post).toEqual({
      slug: 'second-post',
      title: 'Second post',
      date: '2026-09-10',
      description: 'The second one.',
    });
  });

  it('renders a post body to HTML', async () => {
    const post = await getPost('why-we-built-bigshop');
    expect(post.title).toBe('Why we built Big Shop');
    expect(post.html).toContain('<strong>body</strong>');
    expect(post.html).toContain('<a href="/support">link</a>');
  });

  it('refuses a post missing a required frontmatter field, rather than rendering it blank', async () => {
    setFiles({ 'broken.md': '---\ntitle: "No description"\ndate: "2026-01-01"\n---\n\nBody.\n' });
    await expect(getPost('broken')).rejects.toThrow(/description/);
  });
});
