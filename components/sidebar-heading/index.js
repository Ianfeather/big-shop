import styles from './index.module.css';

const SidebarHeading = ({ children, tone = 'default' }) => {
  const className = `${styles.heading} ${tone === 'tinted' ? styles.tinted : ''}`;
  return (
    <h4 className={className}>{children}</h4>
  )
}

export default SidebarHeading;
