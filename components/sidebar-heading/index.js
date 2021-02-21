import styles from './index.module.css';

const SidebarHeading = ({ children }) => {
  return (
    <h4 className={styles.heading}>{children}</h4>
  )
}

export default SidebarHeading;
