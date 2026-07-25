import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagPill from './index';

describe('TagPill', () => {
  it('renders as a static span with no onClick given', () => {
    render(<TagPill tag="Vegetarian" />);

    expect(screen.getByText('Vegetarian').closest('button')).toBeNull();
  });

  it('renders as a clickable button and fires onClick', async () => {
    const onClick = vi.fn();
    render(<TagPill tag="Vegetarian" onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: /Vegetarian/ }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('falls back to the neutral tag icon for an unknown tag', () => {
    render(<TagPill tag="Quick" onClick={() => {}} />);

    expect(screen.getByRole('button', { name: /Quick/ }).querySelector('svg')).toBeInTheDocument();
  });
});
