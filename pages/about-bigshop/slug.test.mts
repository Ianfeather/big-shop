import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlogPost from './[slug]';

// Colocated under pages/, hence .mts and createElement - see
// index.test.mts and pages/recipes/add/slug.test.mts. Named slug.test.mts
// without the brackets for the same reason [slug].tsx's own test is.

const post = {
  slug: 'why-we-built-bigshop',
  title: 'Why we built Big Shop',
  date: '2026-09-06',
  description: 'The short version.',
  html: '<p>Some <strong>body</strong> text.</p>',
};

describe('a blog post page', () => {
  it('renders the post title, date and rendered body', () => {
    render(createElement(BlogPost, { post }));

    expect(screen.getByRole('heading', { level: 1, name: post.title })).toBeInTheDocument();
    expect(screen.getByText('6 September 2026')).toBeInTheDocument();
    // From lib/blog.ts's rendered HTML, not retyped copy - proves the
    // dangerouslySetInnerHTML wiring actually renders the post's own markup.
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('links back to the section index, without calling it "blog"', () => {
    render(createElement(BlogPost, { post }));

    const backLinks = screen.getAllByRole('link', { name: /About Bigshop|All posts/ });
    expect(backLinks.length).toBeGreaterThan(0);
    backLinks.forEach(link => expect(link).toHaveAttribute('href', '/about-bigshop'));
  });

  it('never calls the section "blog" anywhere a reader sees it', () => {
    render(createElement(BlogPost, { post }));
    expect(document.body.textContent?.toLowerCase()).not.toContain('blog');
  });

  it('links to the homepage, Privacy and Support', () => {
    render(createElement(BlogPost, { post }));

    expect(screen.getByRole('link', { name: 'Big Shop' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
  });
});
