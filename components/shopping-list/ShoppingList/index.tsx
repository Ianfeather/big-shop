import styles from './index.module.css'
import Item from './Item';
import ClearList from './clear-list';
import PageHeading from '@components/page-heading';
import EmptyState from '@components/empty-state';
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

interface ShoppingListProps {
  shoppingList: Record<string, ListIngredient>;
  extras: Record<string, ListIngredient>;
  buyIngredient: (name: string, type: 'ingredient' | 'extra') => void;
  clearList: () => void;
}

const ShoppingList = ({ shoppingList, extras, buyIngredient, clearList }: ShoppingListProps) => {

  const boughtItems = Object.keys(shoppingList).filter((name => shoppingList[name].isBought));
  const boughtExtras = Object.keys(extras).filter((name => extras[name].isBought));
  const hasListItems = !!Object.keys(shoppingList).length || !!Object.keys(extras).length;
  const hasBoughtItems = !!boughtItems.length || !!boughtExtras.length;

  const ingredients = Object.keys(shoppingList)
    .filter((name => !shoppingList[name].isBought))
    .sort(sortByDepartment(shoppingList));

  return (
    <>
      {/* Clear list sits up here on the masthead rather than at the foot of the
          list: it used to be the page's only footer, stranded below however many
          items you had, and this is where the (now deleted) item count was. */}
      <PageHeading action={hasListItems ? <ClearList onClick={clearList} /> : undefined}>
        Your shopping list
      </PageHeading>
      { !hasListItems && (
          <EmptyState
            illustration={EmptyBasketIllustration}
            illustrationLabel="Empty shopping basket"
            title="Your shopping list is empty"
          >
            Tick a recipe and its ingredients land here &mdash; added up across everything
            you&rsquo;ve picked, in the order you walk the shop.
          </EmptyState>
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
    </>
  )
}

export default ShoppingList;
