import styles from './index.module.css';
import { useState } from 'react';

const AddExtra = ({ onAdd }) => {
  let [extraItem, setExtraItem] = useState('');

  function addExtraItemOnEnter(e) {
    if (e.which !== 13) { return }
    onAdd(extraItem);
    setExtraItem('');
  }

  function addExtra(e) {
    e.preventDefault();
    onAdd(extraItem);
    setExtraItem('');
  }

  return  (
    <div>
      <h4 className={styles.heading} htmlFor="extra-list-item">Non-recipe items</h4>
      <div className={styles.extraListContainer}>
        <input className={styles.input} placeholder="beer, snacks..." autoComplete="off" type="text" id="extra-list-item" value={extraItem} onKeyPress={addExtraItemOnEnter} onChange={(e) => setExtraItem(e.target.value)} />
        <button onClick={addExtra} className={styles.addButton}>Add</button>
      </div>
    </div>
  );
};

export default AddExtra;
