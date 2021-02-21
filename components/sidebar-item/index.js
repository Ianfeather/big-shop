import styles from './index.module.css';

const ListItem = ({ id, name, checked = false, onClick}) => {
  const className = `${styles.listItem} ${checked ? styles.checked : ''}`;
  return (
    <li key={id} className={className}>
      <label htmlFor={id}>
        {name}
        <input type="checkbox" id={id} className={styles.hidden} onChange={onClick}/>
      </label>
    </li>
  );
};

export default ListItem;
