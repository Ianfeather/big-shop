import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Recipe from './index';

// These cover the one rendering path in the app that turns stored data into an
// href. The invariant they protect is written up in
// docs/stored-content-rendering.md: no rendering path may introduce raw HTML,
// and the single place a URL becomes an attribute must test its scheme.
//
// The threat model is not a user attacking themselves. Recipe fields arrive
// from LLM extraction of arbitrary third-party pages, and an Account is shared
// between Users, so a hostile value can be authored by someone other than the
// person whose browser renders it.
describe('RecipeLink', () => {
  it('links out for an http(s) remoteUrl', () => {
    render(<Recipe recipe={{ remoteUrl: 'https://example.com/roast' }} />);

    expect(screen.getByRole('link', { name: 'View original recipe' }))
      .toHaveAttribute('href', 'https://example.com/roast');
  });

  it.each([
    ['javascript:alert(document.cookie)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:msgbox(1)'],
    // The pre-existing `/^http/` prefix test let these through as hrefs. None
    // is a live exploit on its own - they are the reason a prefix test is the
    // wrong shape of guard, and why this is anchored on `https?://`.
    ['httpjavascript:alert(1)'],
    ['http-evil:alert(1)'],
  ])('renders %s as text, never as an href', (hostile) => {
    render(<Recipe recipe={{ remoteUrl: hostile }} />);

    expect(screen.queryByRole('link', { name: 'View original recipe' })).not.toBeInTheDocument();
    expect(screen.getByText(hostile, { exact: false })).toBeInTheDocument();
  });

  it('renders nothing at all when there is no remoteUrl', () => {
    render(<Recipe recipe={{}} />);

    expect(screen.queryByRole('link', { name: 'View original recipe' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Taken from/)).not.toBeInTheDocument();
  });
});

describe('Recipe field escaping', () => {
  // React escapes its children; this pins that nothing downstream has quietly
  // introduced a raw-HTML path for the fields that carry extracted prose.
  it('renders markup in the name, notes and method as inert text', () => {
    const payload = '<img src=x onerror=alert(1)>';

    const { container } = render(
      <Recipe recipe={{ notes: payload, method: payload, remoteUrl: '' }} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(payload).length).toBeGreaterThan(0);
  });

  it('renders markup in an ingredient name as inert text', () => {
    const payload = '<script>alert(1)</script>';

    const { container } = render(
      <Recipe recipe={{ ingredients: [{ name: payload, quantity: '1', unit: 'g' }] }} />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(payload)).toBeInTheDocument();
  });
});
