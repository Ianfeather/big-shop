import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseAuth0 = vi.fn();
vi.mock('@hooks/use-auth', () => ({ default: () => mockUseAuth0() }));
vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/recipes' }) }));

import Header from './Header';

describe('Header', () => {
  it('hides navigation and the user menu when not authenticated', () => {
    mockUseAuth0.mockReturnValue({ isAuthenticated: false, user: null });
    render(<Header />);

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Recipes')).not.toBeInTheDocument();
  });

  it('shows navigation with the current page link marked active when authenticated', () => {
    mockUseAuth0.mockReturnValue({ isAuthenticated: true, user: { name: 'Jane' } });
    render(<Header />);

    const recipesLink = screen.getByText('Your Recipes');
    const listLink = screen.getByText('Shopping List');
    expect(recipesLink.className).toMatch(/activeLink/);
    expect(listLink.className).not.toMatch(/activeLink/);
  });
});
