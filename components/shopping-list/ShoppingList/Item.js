import styles from './index.module.css';

const Item = ({type, name, item, bought = false, handleClick}) => {
  const quantity = type == 'ingredient' ? item.quantity : null;
  const unit = type == 'ingredient' ? item.unit : null;
  const className = `${styles.item} ${bought ? styles.bought : ''}`;

  return (
    <li key={name}>
      <button type="button" role="checkbox" aria-checked={bought} className={className} onClick={() => handleClick(name, type)}>
        <span className={styles.check} aria-hidden="true">
          <span className={styles.checkMark}></span>
        </span>
        <span className={styles.itemName}>{name}</span>
        {(quantity || unit) && (
          <span className={styles.amount}>{quantity} {unit}</span>
        )}
      </button>
    </li>
  );
};

export default Item;
