import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarTagFilter from './index';

describe('SidebarTagFilter', () => {
  it('renders an All pill plus one pill per tag, and reports the selected value', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value="" onChange={onChange} />);

    expect(screen.getByText('All')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Vegetarian/ }));

    expect(onChange).toHaveBeenCalledWith('Vegetarian');
  });

  it('clicking All reports an empty value', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian']} value="Vegetarian" onChange={onChange} />);

    await userEvent.click(screen.getByText('All'));

    expect(onChange).toHaveBeenCalledWith('');
  });
});
