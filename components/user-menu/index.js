import Link from 'next/link'
import { useState } from 'react';
import styles from './index.module.css'
import Logout from '../identity/logout';
import TrashIcon from '@components/svg/trash';

const UserMenu = ({ className, user }) => {
  const [isOpen, setOpen] = useState(false);
  const toggleMenu = (e) => {
    e.preventDefault();
    setOpen(!isOpen);
  }

  return (
    <div className={`${styles.userMenu} ${isOpen ? styles.open : ''}`}>
      <div className={styles.userBackground} />
      <button className={styles.userMenuTrigger} onClick={toggleMenu}>
        <TrashIcon className={styles.userIcon} />
      </button>
      {
        isOpen && (
          <div className={styles.userMenuContainer}>
            <Link href="/account">
              <a className={styles.link}>Account</a>
            </Link>
            <Logout className={`${styles.logout} ${styles.link}`} />
          </div>
        )
      }
    </div>
  )
}

export default UserMenu;
