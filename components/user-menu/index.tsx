import Link from 'next/link'
import { MouseEvent, useState } from 'react';
import styles from './index.module.css'
import Logout from '../identity/logout';
import UserIcon from '@components/svg/user';

interface UserMenuProps {
  className?: string;
  user?: unknown;
}

const UserMenu = ({ className, user }: UserMenuProps) => {
  const [isOpen, setOpen] = useState(false);
  const toggleMenu = (e: MouseEvent) => {
    e.preventDefault();
    setOpen(!isOpen);
  }

  return (
    <div className={`${styles.userMenu} ${isOpen ? styles.open : ''}`}>
      <button className={styles.userMenuTrigger} onClick={toggleMenu} aria-expanded={isOpen} aria-label="Account menu">
        <UserIcon className={styles.userIcon} />
      </button>
      {
        isOpen && (
          <div className={styles.userMenuContainer}>
            <Link href="/account" className={styles.link}>
              Account
            </Link>
            <Logout className={`${styles.logout} ${styles.link}`} />
          </div>
        )
      }
    </div>
  )
}

export default UserMenu;
