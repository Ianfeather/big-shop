import styles from './index.module.css';

export default function SingleColumnLayout({ children }) {
  return <div className={styles.singleColumn}>{children}</div>
}
