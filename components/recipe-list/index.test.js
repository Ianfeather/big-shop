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
});
