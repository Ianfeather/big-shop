import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkHtml from 'remark-html';

// The markdown-to-post pipeline for /about-bigshop: drop a `.md` file with
// frontmatter into content/posts/, and it becomes a listed, rendered page -
// no other change needed. Lives in lib/ rather than under pages/about-bigshop/
// because a non-route helper module colocated under pages/ gets compiled as a
// broken route once its extension matches pageExtensions - see CLAUDE.md's
// testing section and lib/dave/tools.ts for the precedent this follows.
//
// Rendering happens here, at build time (called from getStaticProps/
// getStaticPaths), rather than shipping a markdown parser to the browser: a
// reader gets plain HTML, and remark/gray-matter never appear in the client
// bundle.

const POSTS_DIR = join(process.cwd(), 'content', 'posts');

export interface PostMeta {
  slug: string;
  title: string;
  // Kept as the ISO string from frontmatter (YYYY-MM-DD) rather than a Date,
  // so every caller formats it the same way - see formatPostDate below.
  date: string;
  description: string;
}

export interface Post extends PostMeta {
  html: string;
}

interface RequiredFrontmatter {
  title: string;
  date: string;
  description: string;
}

// Fails loudly on a post missing a field, rather than rendering a page with a
// blank title or falling back to something guessed - the same "loud rather
// than guessing" choice lib/analytics/page-titles.ts makes for routes.
function assertFrontmatter(
  data: Record<string, unknown>,
  slug: string
): asserts data is Record<string, unknown> & RequiredFrontmatter {
  for (const field of ['title', 'date', 'description'] as const) {
    if (typeof data[field] !== 'string' || !data[field]) {
      throw new Error(`content/posts/${slug}.md is missing required frontmatter field "${field}"`);
    }
  }
}

function readPostFile(slug: string) {
  const raw = readFileSync(join(POSTS_DIR, `${slug}.md`), 'utf8');
  return matter(raw);
}

// Every published slug, for getStaticPaths. The filename *is* the slug -
// there is no separate id in frontmatter to keep in sync with it.
export function getAllSlugs(): string[] {
  return readdirSync(POSTS_DIR)
    .filter(name => name.endsWith('.md'))
    .map(name => name.replace(/\.md$/, ''));
}

// Metadata for every post, newest first. No markdown rendering here - the
// listing page never needs a post's body, only its frontmatter.
export function getAllPosts(): PostMeta[] {
  return getAllSlugs()
    .map(slug => {
      const { data } = readPostFile(slug);
      assertFrontmatter(data, slug);
      return { slug, title: data.title, date: data.date, description: data.description };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getPost(slug: string): Promise<Post> {
  const { data, content } = readPostFile(slug);
  assertFrontmatter(data, slug);
  const rendered = await remark().use(remarkHtml).process(content);
  return {
    slug,
    title: data.title,
    date: data.date,
    description: data.description,
    html: String(rendered),
  };
}
