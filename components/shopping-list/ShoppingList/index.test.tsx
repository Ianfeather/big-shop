import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShoppingList from './index';
import type { ListIngredient } from '../../../types/models';

// Extra Items carry placeholder quantity/unit/department/recipe_id values in
// the real API (see CONTEXT.md's Shopping List Item entry) - this mirrors
// that so fixtures satisfy ListIngredient without pretending those fields
// are meaningful for an extra.
const ingredient = (overrides: Partial<ListIngredient> = {}): ListIngredient => ({
  quantity: 0, unit: '', department: '', recipe_id: 0, isBought: false, ...overrides
});

describe('ShoppingList', () => {
  it('shows an empty-basket illustration and no clear button when there is nothing to buy', () => {
    render(<ShoppingList shoppingList={{}} extras={{}} buyIngredient={() => {}} clearList={() => {}} />);

    expect(screen.getByRole('img', { name: /empty shopping basket/i })).toBeInTheDocument();
    expect(screen.getByText(/your shopping list is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/clear list/i)).not.toBeInTheDocument();
  });

  it('lists unbought ingredients and extras, and calls buyIngredient with name/type on click', async () => {
    const buyIngredient = vi.fn();
    render(
      <ShoppingList
        shoppingList={{ chicken: ingredient({ quantity: 1, unit: 'kg', department: 'meat and fish' }) }}
        extras={{ beer: ingredient() }}
        buyIngredient={buyIngredient}
        clearList={() => {}}
      />
    );

    expect(screen.getByText('chicken')).toBeInTheDocument();
    expect(screen.getByText('beer')).toBeInTheDocument();
    expect(screen.queryByText('Already bought')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('chicken'));
    expect(buyIngredient).toHaveBeenCalledWith('chicken', 'ingredient');

    await userEvent.click(screen.getByText('beer'));
    expect(buyIngredient).toHaveBeenCalledWith('beer', 'extra');
  });

  it('separates bought ingredients/extras into an "Already bought" section', () => {
    render(
      <ShoppingList
        shoppingList={{
          chicken: ingredient({ quantity: 1, unit: 'kg', department: 'meat and fish' }),
          rice: ingredient({ quantity: 300, unit: 'gram', department: 'other', isBought: true })
        }}
        extras={{ beer: ingredient({ isBought: true }) }}
        buyIngredient={() => {}}
        clearList={() => {}}
      />
    );

    expect(screen.getByText('Already bought')).toBeInTheDocument();
    const boughtSection = screen.getByText('Already bought').closest('div');
    expect(boughtSection).toHaveTextContent('rice');
    expect(boughtSection).toHaveTextContent('beer');
    expect(boughtSection).not.toHaveTextContent('chicken');
  });

  it('groups items sharing a department together rather than interleaving them', () => {
    render(
      <ShoppingList
        shoppingList={{
          carrot: ingredient({ quantity: 2, unit: '', department: 'vegetables' }),
          potato: ingredient({ quantity: 1, unit: 'kg', department: 'vegetables' }),
          chicken: ingredient({ quantity: 1, unit: 'kg', department: 'meat and fish' })
        }}
        extras={{}}
        buyIngredient={() => {}}
        clearList={() => {}}
      />
    );

    const names = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    const vegetableIndices = ['carrot', 'potato'].map(name => names.findIndex(t => t.includes(name)));
    expect(Math.abs(vegetableIndices[0] - vegetableIndices[1])).toBe(1);
  });

  it('shows the clear-list control whenever there is anything on the list', async () => {
    const clearList = vi.fn();
    render(
      <ShoppingList
        shoppingList={{ chicken: ingredient({ quantity: 1, unit: 'kg', department: 'meat and fish' }) }}
        extras={{}}
        buyIngredient={() => {}}
        clearList={clearList}
      />
    );

    expect(screen.getByText(/clear list and start over/i)).toBeInTheDocument();
  });
});
