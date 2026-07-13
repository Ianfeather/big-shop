import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './index';

describe('Button', () => {
  it('renders a button and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a link instead of a button when href is provided', () => {
    render(<Button href="/recipes">Recipes</Button>);

    expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('href', '/recipes');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the requested icon', () => {
    render(<Button icon="trash">Delete</Button>);

    expect(screen.getByRole('button', { name: 'Delete' }).querySelector('svg')).toBeInTheDocument();
  });
});
