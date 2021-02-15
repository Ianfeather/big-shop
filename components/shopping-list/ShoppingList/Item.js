import styles from './index.module.css';

const Item = ({type, name, item, handleClick}) => {
  const quantity = type == 'ingredient' ? item.quantity : null;
  const unit = type == 'ingredient' ? item.unit : null;

  return (
    <li className={styles.item} key={name} onClick={() => handleClick(name, type)}>
      <span className={styles.itemName}>{name}</span>
      <span className={styles.itemQuantity}>{quantity}</span>
      <span className={styles.itemUnit}>{unit}</span>
    </li>
  );
};

export default Item;
