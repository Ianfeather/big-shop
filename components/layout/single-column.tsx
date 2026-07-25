import { ReactNode } from 'react';
import styles from './index.module.css';

export default function SingleColumnLayout({ children }: { children: ReactNode }) {
  return <div className={styles.singleColumn}>{children}</div>
}
