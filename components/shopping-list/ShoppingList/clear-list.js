import { useState } from 'react';
import Button from '@components/button';
import styles from './clear.module.css';

const ClearList = ({ onClick }) => {
  const [isClicked, setClicked] = useState(false);

  const handleClear = () => setClicked(true);
  const handleCancel = () => setClicked(false);

  return (
    <div className={styles.container}>
      {
        isClicked ?
        (
          <>
            <Button className={styles.clear} style="red" outline={true} icon="cross" onClick={() => onClick()}>You sure? Click to confirm</Button>
            <Button style="blue" outline={true} icon="cross" onClick={() => handleCancel()}>Cancel</Button>
          </>
        ) :
        <Button className={styles.clear} style="red" outline={true} icon="cross" onClick={() => handleClear()}>Clear list and start over</Button>
      }
    </div>
  );
}

export default ClearList;
