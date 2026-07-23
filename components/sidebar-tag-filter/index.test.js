import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarTagFilter from './index';

describe('SidebarTagFilter', () => {
  it('starts collapsed, with only the Filter toggle visible', () => {
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value={[]} onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.queryByText('Vegetarian')).not.toBeInTheDocument();
  });

  it('opens to show an All pill plus one pill per tag, and reports the toggled tag', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value={[]} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('All')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));

    expect(onChange).toHaveBeenCalledWith('Vegetarian');
  });

  it('clicking All reports an empty value', async () => {
    const onChange = vi.fn();
    render(<SidebarTagFilter tags={['Vegetarian']} value={['Vegetarian']} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    await userEvent.click(screen.getByText('All'));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('keeps the panel open after selecting a tag, so more can be picked', async () => {
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value={[]} onChange={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /filter/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batch Cook' })).toBeInTheDocument();
  });

  it('shows a count next to the toggle instead of the selected tags themselves', () => {
    render(<SidebarTagFilter tags={['Vegetarian', 'Batch Cook']} value={['Vegetarian', 'Batch Cook']} onChange={() => {}} />);

    const toggle = screen.getByRole('button', { name: /filter/i });
    expect(toggle).toHaveTextContent('(2)');
  });

  it('shows no count when nothing is selected', () => {
    render(<SidebarTagFilter tags={['Vegetarian']} value={[]} onChange={() => {}} />);

    const toggle = screen.getByRole('button', { name: /filter/i });
    expect(toggle).not.toHaveTextContent('(0)');
  });
});
