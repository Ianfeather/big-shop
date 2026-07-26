import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Item from './Item';
import type { ListIngredient } from '../../../types/models';

const item = (overrides: Partial<ListIngredient> = {}): ListIngredient => ({
  amounts: [], department: '', recipe_id: 0, isBought: false, ...overrides
});

describe('Item', () => {
  it('renders a single combined amount', () => {
    render(
      <Item type="ingredient" name="mince" handleClick={() => {}}
        item={item({ amounts: [{ quantity: '1.5', unit: 'kilogram' }] })} />
    );

    expect(screen.getByText('1.5 kilogram')).toBeInTheDocument();
  });

  // The point of Amounts being a list: quantities that can't be combined
  // without a Unit Size still both reach the shopper, on one line with one
  // checkbox, rather than one being dropped or a number being invented.
  it('joins amounts that could not be combined', () => {
    render(
      <Item type="ingredient" name="flour" handleClick={() => {}}
        item={item({ amounts: [
          { quantity: '50', unit: 'gram' },
          { quantity: '2', unit: 'tablespoon' }
        ] })} />
    );

    expect(screen.getByText('50 gram + 2 tablespoon')).toBeInTheDocument();
  });

  it('is still one checkbox no matter how many amounts it has', async () => {
    const handleClick = vi.fn();
    render(
      <Item type="ingredient" name="flour" handleClick={handleClick}
        item={item({ amounts: [
          { quantity: '50', unit: 'gram' },
          { quantity: '2', unit: 'tablespoon' }
        ] })} />
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(handleClick).toHaveBeenCalledWith('flour', 'ingredient');
  });

  // A blank unit is the bare-count sentinel ("3 eggs"), not missing data.
  it('renders a bare count without a trailing unit', () => {
    render(
      <Item type="ingredient" name="egg" handleClick={() => {}}
        item={item({ amounts: [{ quantity: '3', unit: '' }] })} />
    );

    expect(screen.getByRole('checkbox')).toHaveTextContent(/^egg\s*3$/);
  });

  it('renders a quantity that could not be parsed verbatim rather than dropping it', () => {
    render(
      <Item type="ingredient" name="parsley" handleClick={() => {}}
        item={item({ amounts: [
          { quantity: '20', unit: 'gram' },
          { quantity: 'a handful', unit: 'gram' }
        ] })} />
    );

    expect(screen.getByText('20 gram + a handful gram')).toBeInTheDocument();
  });

  it('shows no amount for an Extra Item', () => {
    const { container } = render(
      <Item type="extra" name="beer" handleClick={() => {}} />
    );

    expect(screen.getByText('beer')).toBeInTheDocument();
    expect(container.querySelector('[class*="amount"]')).toBeNull();
  });

  it('shows no amount when an ingredient somehow has none', () => {
    const { container } = render(
      <Item type="ingredient" name="mystery" handleClick={() => {}} item={item()} />
    );

    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(container.querySelector('[class*="amount"]')).toBeNull();
  });

  it('marks a bought item as checked', () => {
    render(
      <Item type="ingredient" name="mince" bought handleClick={() => {}}
        item={item({ amounts: [{ quantity: '1', unit: 'kilogram' }] })} />
    );

    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });
});
