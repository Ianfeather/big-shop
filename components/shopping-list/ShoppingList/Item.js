import styles from './index.module.css';

const Item = ({type, name, item, bought = false, handleClick}) => {
  const quantity = type == 'ingredient' ? item.quantity : null;
  const unit = type == 'ingredient' ? item.unit : null;
  const className = `${styles.item} ${bought ? styles.bought : ''}`;

  return (
    <li className={className} key={name} onClick={() => handleClick(name, type)}>
      <span className={styles.check} aria-hidden="true">
        <span className={styles.checkMark}></span>
      </span>
      <span className={styles.itemName}>{name}</span>
      <span className={styles.itemQuantity}>{quantity}</span>
      <span className={styles.itemUnit}>{unit}</span>
    </li>
  );
};

export default Item;
