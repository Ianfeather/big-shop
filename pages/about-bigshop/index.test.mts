import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutBigshopIndex from './index';

// Colocated under pages/, so this must be .mts rather than .tsx - Next treats
// every pageExtensions file under pages/ as a route, and a test file has no
// default export, which fails the build from Next 16. See CLAUDE.md's Testing
// section and pages/recipes/add/slug.test.mts for the established pattern.
// .mts cannot hold JSX, hence createElement.

const posts = [
  { slug: 'second-post', title: 'Second post', date: '2026-09-10', description: 'Second description.' },
  { slug: 'why-we-built-bigshop', title: 'Why we built Big Shop', date: '2026-09-06', description: 'First description.' },
];

describe('the /about-bigshop listing page', () => {
  it('lists every post, newest first, with a link to its own page', () => {
    render(createElement(AboutBigshopIndex, { posts }));

    expect(screen.getByRole('link', { name: /Second post/ }))
      .toHaveAttribute('href', '/about-bigshop/second-post');
    expect(screen.getByRole('link', { name: /Why we built Big Shop/ }))
      .toHaveAttribute('href', '/about-bigshop/why-we-built-bigshop');
  });

  it('shows each post\'s description and formatted date', () => {
    render(createElement(AboutBigshopIndex, { posts }));

    expect(screen.getByText('Second description.')).toBeInTheDocument();
    expect(screen.getByText('10 September 2026')).toBeInTheDocument();
  });

  // The whole point of the /about-bigshop path: this section is never
  // labelled "Blog" anywhere a reader sees it.
  it('never calls the section "blog" anywhere a reader sees it', () => {
    render(createElement(AboutBigshopIndex, { posts }));
    expect(document.body.textContent?.toLowerCase()).not.toContain('blog');
  });

  it('renders no post cards when there are no posts yet', () => {
    const { container } = render(createElement(AboutBigshopIndex, { posts: [] }));
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('links back to the homepage and into Privacy and Support', () => {
    render(createElement(AboutBigshopIndex, { posts }));

    expect(screen.getByRole('link', { name: 'Back to the homepage' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
  });
});
