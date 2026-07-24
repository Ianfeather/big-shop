import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddExtra from './AddExtra';

describe('AddExtra', () => {
  it('adds the typed item and clears the input when the Add button is clicked', async () => {
    const onAdd = vi.fn();
    render(<AddExtra onAdd={onAdd} />);
    const input = screen.getByPlaceholderText('beer, snacks...');

    await userEvent.type(input, 'beer');
    await userEvent.click(screen.getByText('Add'));

    expect(onAdd).toHaveBeenCalledWith('beer');
    expect(input).toHaveValue('');
  });

  it('adds the typed item on Enter without clicking Add', async () => {
    const onAdd = vi.fn();
    render(<AddExtra onAdd={onAdd} />);
    const input = screen.getByPlaceholderText('beer, snacks...');

    await userEvent.type(input, 'crisps{Enter}');

    expect(onAdd).toHaveBeenCalledWith('crisps');
    expect(input).toHaveValue('');
  });

  it('does not submit on other key presses', async () => {
    const onAdd = vi.fn();
    render(<AddExtra onAdd={onAdd} />);
    const input = screen.getByPlaceholderText('beer, snacks...');

    await userEvent.type(input, 'crisps');

    expect(onAdd).not.toHaveBeenCalled();
  });
});
