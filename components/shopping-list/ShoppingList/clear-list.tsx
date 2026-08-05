import { useState } from 'react';
import icons from '@components/svg';
import styles from './clear.module.css';

const TrashIcon = icons.trash;

interface ClearListProps {
  onClick: () => void;
}

// Text actions rather than outlined buttons: on the one-sheet layout a bordered
// button at the foot of the list was the last box left on the page, and it now
// sits on the masthead where a solid button would compete with the title. The
// two-step confirm (and both labels) is unchanged - clearing the list is
// destructive and there's no undo.
const ClearList = ({ onClick }: ClearListProps) => {
  const [isClicked, setClicked] = useState(false);

  const handleClear = () => setClicked(true);
  const handleCancel = () => setClicked(false);

  return (
    <div className={styles.container}>
      {
        isClicked ?
        (
          <>
            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => onClick()}>
              You sure? Click to confirm
            </button>
            <button type="button" className={styles.action} onClick={() => handleCancel()}>Cancel</button>
          </>
        ) :
        <button type="button" className={styles.action} onClick={() => handleClear()}>
          <TrashIcon className={styles.icon} aria-hidden="true" />
          Clear list and start over
        </button>
      }
    </div>
  );
}

export default ClearList;
