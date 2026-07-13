import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShoppingList from './index';

describe('ShoppingList', () => {
  it('shows an empty-list message and no clear button when there is nothing to buy', () => {
    render(<ShoppingList shoppingList={{}} extras={{}} buyIngredient={() => {}} clearList={() => {}} />);

    expect(screen.getByText(/don.t need to go shopping/i)).toBeInTheDocument();
    expect(screen.queryByText(/clear list/i)).not.toBeInTheDocument();
  });

  it('lists unbought ingredients and extras, and calls buyIngredient with name/type on click', async () => {
    const buyIngredient = vi.fn();
    render(
      <ShoppingList
        shoppingList={{ chicken: { quantity: '1', unit: 'kg', department: 'meat and fish', isBought: false } }}
        extras={{ beer: { isBought: false } }}
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
          chicken: { quantity: '1', unit: 'kg', department: 'meat and fish', isBought: false },
          rice: { quantity: '300', unit: 'gram', department: 'other', isBought: true }
        }}
        extras={{ beer: { isBought: true } }}
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
          carrot: { quantity: '2', unit: '', department: 'vegetables', isBought: false },
          potato: { quantity: '1', unit: 'kg', department: 'vegetables', isBought: false },
          chicken: { quantity: '1', unit: 'kg', department: 'meat and fish', isBought: false }
        }}
        extras={{}}
        buyIngredient={() => {}}
        clearList={() => {}}
      />
    );

    const names = screen.getAllByRole('listitem').map(li => li.textContent);
    const vegetableIndices = ['carrot', 'potato'].map(name => names.findIndex(t => t.includes(name)));
    expect(Math.abs(vegetableIndices[0] - vegetableIndices[1])).toBe(1);
  });

  it('shows the clear-list control whenever there is anything on the list', async () => {
    const clearList = vi.fn();
    render(
      <ShoppingList
        shoppingList={{ chicken: { quantity: '1', unit: 'kg', department: 'meat and fish', isBought: false } }}
        extras={{}}
        buyIngredient={() => {}}
        clearList={clearList}
      />
    );

    expect(screen.getByText(/clear list and start over/i)).toBeInTheDocument();
  });
});
