import styles from './index.module.css'
import Item from './Item';
import ClearList from './clear-list';
import EmptyBasketIllustration from '@components/svg/empty-basket';

const ShoppingList = ({ shoppingList, extras, buyIngredient, clearList }) => {

  const boughtItems = Object.keys(shoppingList).filter((name => shoppingList[name].isBought));
  const boughtExtras = Object.keys(extras).filter((name => extras[name].isBought));
  const hasListItems = !!Object.keys(shoppingList).length || !!Object.keys(extras).length;
  const hasBoughtItems = !!boughtItems.length || !!boughtExtras.length;

  const ingredients = Object.keys(shoppingList)
    .filter((name => !shoppingList[name].isBought))
    .sort(function sortByDepartment(_a, _b) {
      let a = shoppingList[_a];
      let b = shoppingList[_b];
      if (a.department === b.department) return 0
      if (b.department === 'vegetables') return 1
      if (!b.department || a.department === 'vegetables') return -1
    });

  return (
    <>
      <h2 className={styles.heading}>Your shopping list</h2>
      { !hasListItems && (
          <div className={styles.emptyState}>
            <EmptyBasketIllustration className={styles.emptyBasketIllustration} role="img" aria-label="Empty shopping basket" />
            <p className={styles.emptyStateText}>Your shopping list is empty</p>
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
