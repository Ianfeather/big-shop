import styles from './index.module.css';
import type { ListIngredient } from '../../../types/models';

interface ItemProps {
  type: 'ingredient' | 'extra';
  name: string;
  item?: ListIngredient;
  bought?: boolean;
  handleClick: (name: string, type: 'ingredient' | 'extra') => void;
}

// An Ingredient Item carries one or more Amounts: several when some of them
// couldn't be combined for want of a Unit Size, so "50 g + 2 tbsp" is one line
// with one checkbox rather than a guessed-at single number (CONTEXT.md's
// Shopping List Item, docs/adr/0005). A blank unit is the bare-count sentinel
// ("3 eggs"), so it's dropped rather than rendered as a trailing space.
// An Amount converted into a Display Unit keeps the amount it was added up in,
// so "2 tins (800 g)" shows its working - a Unit Size is an approximation, and
// if your tin is really 390 g you can see what was assumed.
function formatAmounts(amounts: ListIngredient['amounts'] | undefined): string {
  return (amounts ?? [])
    .map(({ quantity, unit, baseQuantity, baseUnit }) => {
      const primary = [quantity, unit].filter(Boolean).join(' ');
      const base = [baseQuantity, baseUnit].filter(Boolean).join(' ');
      return base ? `${primary} (${base})` : primary;
    })
    .filter(Boolean)
    .join(' + ');
}

const Item = ({type, name, item, bought = false, handleClick}: ItemProps) => {
  // Extra Items have no meaningful amount at all - they're a plain checklist
  // entry, and their underlying row only carries placeholder values.
  const amount = type === 'ingredient' ? formatAmounts(item?.amounts) : '';
  const className = `${styles.item} ${bought ? styles.bought : ''}`;

  return (
    <li key={name}>
      <button type="button" role="checkbox" aria-checked={bought} className={className} onClick={() => handleClick(name, type)}>
        <span className={styles.check} aria-hidden="true">
          <span className={styles.checkMark}></span>
        </span>
        <span className={styles.itemName}>{name}</span>
        {amount && (
          <span className={styles.amount}>{amount}</span>
        )}
      </button>
    </li>
  );
};

export default Item;
