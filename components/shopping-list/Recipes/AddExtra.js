import styles from './index.module.css';
import { useState } from 'react';
import SidebarInput from '../../sidebar-input';
import SidebarHeading from '../../sidebar-heading';

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
      <SidebarHeading>Non-recipe items</SidebarHeading>
      <div className={styles.extraListContainer}>
        <SidebarInput placeholder="beer, snacks..." id="extra-list-item" value={extraItem} onKeyPress={addExtraItemOnEnter} onChange={(e) => setExtraItem(e.target.value)} />
        <button onClick={addExtra} className={styles.addButton}>Add</button>
      </div>
    </div>
  );
};

export default AddExtra;
