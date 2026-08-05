import styles from './index.module.css'
import Item from './Item';
import ClearList from './clear-list';
import EmptyBasketIllustration from '@components/svg/empty-basket';
import type { ListIngredient } from '../../../types/models';

// Shopping order: non-perishables first, vegetables last since they bruise
// if left sitting in the trolley/bags. Departments not in this list (or a
// missing department) sort after everything else.
const DEPARTMENT_ORDER = ['meat and fish', 'other', 'vegetables'];

function departmentPriority(department: string): number {
  const index = DEPARTMENT_ORDER.indexOf(department);
  return index === -1 ? DEPARTMENT_ORDER.length : index;
}

function sortByDepartment(shoppingList: Record<string, ListIngredient>) {
  return (_a: string, _b: string) => departmentPriority(shoppingList[_a].department) - departmentPriority(shoppingList[_b].department);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

interface ShoppingListProps {
  shoppingList: Record<string, ListIngredient>;
  extras: Record<string, ListIngredient>;
  buyIngredient: (name: string, type: 'ingredient' | 'extra') => void;
  clearList: () => void;
  // Only the page knows how many Recipes are ticked; the list itself is a flat
  // set of Items. Optional so the component still stands up on its own.
  recipeCount?: number;
}

const ShoppingList = ({ shoppingList, extras, buyIngredient, clearList, recipeCount = 0 }: ShoppingListProps) => {

  const boughtItems = Object.keys(shoppingList).filter((name => shoppingList[name].isBought));
  const boughtExtras = Object.keys(extras).filter((name => extras[name].isBought));
  const itemCount = Object.keys(shoppingList).length + Object.keys(extras).length;
  const hasListItems = !!itemCount;
  const hasBoughtItems = !!boughtItems.length || !!boughtExtras.length;

  const ingredients = Object.keys(shoppingList)
    .filter((name => !shoppingList[name].isBought))
    .sort(sortByDepartment(shoppingList));

  return (
    <>
      <div className={styles.masthead}>
        <h2 className={styles.heading}>Your shopping list</h2>
        <p className={styles.meta}>
          {hasListItems ? `${plural(recipeCount, 'recipe')} · ${plural(itemCount, 'item')}` : 'Nothing on it yet'}
        </p>
      </div>
      { !hasListItems && (
          /* Set beside the copy rather than centred in the middle of the page:
             a full-width illustration left a screen-high void whenever the
             list was empty, which is most of the week. */
          <div className={styles.emptyState}>
            <EmptyBasketIllustration className={styles.emptyBasketIllustration} role="img" aria-label="Empty shopping basket" />
            <div>
              <p className={styles.emptyStateText}>Your shopping list is empty</p>
              <p className={styles.emptyStateHint}>
                Tick a recipe and its ingredients land here &mdash; added up across everything
                you&rsquo;ve picked, in the order you walk the shop.
              </p>
            </div>
          </div>
      )}
      <ul className={styles.shoppingList}>
        { ingredients.map((name, i) => (
          <Item type='ingredient' name={name} item={shoppingList[name]} bought={false} handleClick={buyIngredient} key={i}/>
        ))}
        { Object.keys(extras).filter((name => !extras[name].isBought)).map((name, i) => (
          <Item type='extra' name={name} bought={false} handleClick={buyIngredient} key={i}/>
        ))}
      </ul>
      {
        hasBoughtItems && (
          <div className={styles.boughtContainer}>
            <h2>Already bought</h2>
            <ul className={styles.shoppingList}>
              { boughtItems.map((name, i) => (
                <Item type='ingredient' name={name} item={shoppingList[name]} bought={true} handleClick={buyIngredient} key={i}/>
              ))}
              { boughtExtras.map((name, i) => (
                <Item type='extra' name={name} bought={true} handleClick={buyIngredient} key={i}/>
              ))}
            </ul>
          </div>
        )
      }
      { hasListItems && <ClearList onClick={clearList} />}

    </>
  )
}

export default ShoppingList;
