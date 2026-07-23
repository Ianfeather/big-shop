import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recipes = [
  { id: '1', name: "Shepherd's Pie", tags: ['Batch Cook'] },
  { id: '2', name: 'Veggie Chilli', tags: ['Vegetarian', 'Batch Cook'] },
  { id: '3', name: 'Veggie Curry', tags: ['Vegetarian'] }
];

vi.mock('@hooks/use-recipes', () => ({ default: () => [recipes] }));
vi.mock('use-http', () => ({ default: () => ({ get: vi.fn(async () => ['Vegetarian', 'Batch Cook']), response: { ok: true } }) }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RecipeList from './index';

async function renderList(props = {}) {
  render(<RecipeList {...props} />);
  await userEvent.click(screen.getByRole('button', { name: /filter/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vegetarian' })).toBeInTheDocument());
}

describe('RecipeList', () => {
  it('lists every recipe by default', async () => {
    await renderList();

    expect(screen.getByText("Shepherd's Pie")).toBeInTheDocument();
    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
    expect(screen.getByText('Veggie Curry')).toBeInTheDocument();
  });

  it('filters by the search box, case-insensitively', async () => {
    await renderList();

    await userEvent.type(screen.getByPlaceholderText('Search...'), 'chilli');

    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
    expect(screen.queryByText("Shepherd's Pie")).not.toBeInTheDocument();
    expect(screen.queryByText('Veggie Curry')).not.toBeInTheDocument();
  });

  it('filters by tag', async () => {
    await renderList();

    await userEvent.click(screen.getByRole('button', { name: /Vegetarian/ }));

    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
    expect(screen.getByText('Veggie Curry')).toBeInTheDocument();
    expect(screen.queryByText("Shepherd's Pie")).not.toBeInTheDocument();
  });

  it('combines multiple selected tags with OR, not AND', async () => {
    await renderList();

    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));
    await userEvent.click(screen.getByRole('button', { name: 'Batch Cook' }));

    // Shepherd's Pie only has Batch Cook, Veggie Curry only has Vegetarian -
    // both should still show up since either tag is enough to match.
    expect(screen.getByText("Shepherd's Pie")).toBeInTheDocument();
    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
    expect(screen.getByText('Veggie Curry')).toBeInTheDocument();
  });

  it('toggles a tag back off when clicked again', async () => {
    await renderList();

    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vegetarian' }));

    expect(screen.getByText("Shepherd's Pie")).toBeInTheDocument();
    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
    expect(screen.getByText('Veggie Curry')).toBeInTheDocument();
  });

  it('combines search and tag filters', async () => {
    await renderList();

    await userEvent.click(screen.getByRole('button', { name: /Vegetarian/ }));
    await userEvent.type(screen.getByPlaceholderText('Search...'), 'curry');

    expect(screen.getByText('Veggie Curry')).toBeInTheDocument();
    expect(screen.queryByText('Veggie Chilli')).not.toBeInTheDocument();
  });

  it('applies an externally supplied filterFn on top of the built-in filters', async () => {
    await renderList({ filterFn: ({ id }) => id !== '1' });

    expect(screen.queryByText("Shepherd's Pie")).not.toBeInTheDocument();
    expect(screen.getByText('Veggie Chilli')).toBeInTheDocument();
  });

  it('moves selected recipes to the top of the list', async () => {
    await renderList({ selectedIds: { '3': true } });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Veggie Curry');
  });

  it('marks selected recipes as checked, and leaves others unmarked', async () => {
    await renderList({ selectedIds: { '3': true } });

    expect(screen.getByText('Veggie Curry').closest('li').className).toMatch(/checked/);
    expect(screen.getByText("Shepherd's Pie").closest('li').className).not.toMatch(/checked/);
  });
});
