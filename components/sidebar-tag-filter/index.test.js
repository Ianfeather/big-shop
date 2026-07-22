import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarTagFilter from './index';

describe('SidebarTagFilter', () => {
  it('starts collapsed, with only the Filter toggle visible', () => {
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value="" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.queryByText('Vegetarian')).not.toBeInTheDocument();
  });

  it('opens to show an All pill plus one pill per tag, and reports the selected value', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value="" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('All')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));

    expect(onChange).toHaveBeenCalledWith('Vegetarian');
  });

  it('clicking All reports an empty value', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian']} value="Vegetarian" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    await userEvent.click(screen.getByText('All'));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('collapses the panel again once a tag is selected', async () => {
    render(<SidebarTagFilter tags={['Vegetarian']} value="" onChange={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));

    expect(screen.queryByText('All')).not.toBeInTheDocument();
  });

  it('shows the active tag next to the toggle when collapsed, and clears it on click', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value="Vegetarian" onChange={onChange} />);

    const activeTag = screen.getByRole('button', { name: 'Vegetarian' });
    await userEvent.click(activeTag);

    expect(onChange).toHaveBeenCalledWith('');
  });
});
