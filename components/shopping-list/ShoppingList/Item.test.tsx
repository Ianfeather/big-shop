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

  // A Display Unit conversion keeps the amount it was added up in, so an
  // approximate Unit Size can be judged rather than silently trusted.
  it('shows the base amount in brackets when converted to a display unit', () => {
    render(
      <Item type="ingredient" name="chopped tomatoes" handleClick={() => {}}
        item={item({ amounts: [
          { quantity: '2', unit: 'tin', baseQuantity: '800', baseUnit: 'gram' }
        ] })} />
    );

    expect(screen.getByText('2 tin (800 gram)')).toBeInTheDocument();
  });

  it('renders a bare-count display unit without a stray unit word', () => {
    render(
      <Item type="ingredient" name="onion" handleClick={() => {}}
        item={item({ amounts: [
          { quantity: '11', unit: '', baseQuantity: '1.65', baseUnit: 'kilogram' }
        ] })} />
    );

    expect(screen.getByText('11 (1.65 kilogram)')).toBeInTheDocument();
  });

  it('shows no amount for an Extra Item', () => {
    render(<Item type="extra" name="beer" handleClick={() => {}} />);

    // Nothing but the name - asserted on the rendered text rather than a CSS
    // module class, which is an implementation detail.
    expect(screen.getByRole('checkbox')).toHaveTextContent(/^beer$/);
  });

  it('shows no amount when an ingredient somehow has none', () => {
    render(<Item type="ingredient" name="mystery" handleClick={() => {}} item={item()} />);

    expect(screen.getByRole('checkbox')).toHaveTextContent(/^mystery$/);
  });

  it('marks a bought item as checked', () => {
    render(
      <Item type="ingredient" name="mince" bought handleClick={() => {}}
        item={item({ amounts: [{ quantity: '1', unit: 'kilogram' }] })} />
    );

    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });
});
