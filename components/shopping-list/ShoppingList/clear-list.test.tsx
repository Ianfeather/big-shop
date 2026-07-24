import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClearList from './clear-list';

describe('ClearList', () => {
  it('asks for confirmation before calling onClick', async () => {
    const onClick = vi.fn();
    render(<ClearList onClick={onClick} />);

    await userEvent.click(screen.getByText(/clear list and start over/i));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText(/you sure/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/you sure/i));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('cancels back to the initial state without calling onClick', async () => {
    const onClick = vi.fn();
    render(<ClearList onClick={onClick} />);

    await userEvent.click(screen.getByText(/clear list and start over/i));
    await userEvent.click(screen.getByText('Cancel'));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText(/clear list and start over/i)).toBeInTheDocument();
  });
});
