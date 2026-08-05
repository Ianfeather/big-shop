import styles from './index.module.css';
import { KeyboardEvent, MouseEvent, useState } from 'react';
import SidebarInput from '../../sidebar-input';
import SidebarHeading from '../../sidebar-heading';
import Button from '@components/button';

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
      <SidebarHeading>Fancy something extra?</SidebarHeading>
      <div className={styles.extraListContainer}>
        <SidebarInput placeholder="beer, snacks..." id="extra-list-item" value={extraItem} onKeyPress={addExtraItemOnEnter} onChange={(e) => setExtraItem(e.target.value)} />
        {/* The one solid button on the page. Everything else here is a text
            action, which left the rail with no focal point at all. */}
        <Button style="primary" onClick={addExtra} className={styles.addButton}>Add</Button>
      </div>
    </div>
  );
};

export default AddExtra;
