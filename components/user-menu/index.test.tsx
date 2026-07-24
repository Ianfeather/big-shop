import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@hooks/use-auth', () => ({
  default: () => ({ logout: vi.fn() })
}));

import UserMenu from './index';

describe('UserMenu', () => {
  it('opens the menu (Account link + sign out) on trigger click, and closes again on a second click', async () => {
    render(<UserMenu user={{ name: 'Jane' }} />);

    expect(screen.queryByText('Account')).not.toBeInTheDocument();

    const trigger = screen.getAllByRole('button')[0];
    await userEvent.click(trigger);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
  });
});
