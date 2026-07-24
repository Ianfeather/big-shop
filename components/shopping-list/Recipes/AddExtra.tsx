import styles from './index.module.css';
import { KeyboardEvent, MouseEvent, useState } from 'react';
import SidebarInput from '../../sidebar-input';
import SidebarHeading from '../../sidebar-heading';

interface AddExtraProps {
  onAdd: (item: string) => void;
}

const AddExtra = ({ onAdd }: AddExtraProps) => {
  let [extraItem, setExtraItem] = useState('');

  function addExtraItemOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.which !== 13) { return }
    onAdd(extraItem);
    setExtraItem('');
  }

  function addExtra(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    onAdd(extraItem);
    setExtraItem('');
  }

  return  (
    <div className={styles.panel}>
      <SidebarHeading>Non-recipe items</SidebarHeading>
      <div className={styles.extraListContainer}>
        <SidebarInput placeholder="beer, snacks..." id="extra-list-item" value={extraItem} onKeyPress={addExtraItemOnEnter} onChange={(e) => setExtraItem(e.target.value)} />
        <button onClick={addExtra} className={styles.addButton}>Add</button>
      </div>
    </div>
  );
};

export default AddExtra;
