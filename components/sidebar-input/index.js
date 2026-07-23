import styles from './index.module.css';

const SidebarInput = ({ icon: Icon, ...props }) => {
  return (
    <div className={styles.field}>
      {Icon && <Icon className={styles.icon} />}
      <input className={styles.input} autoComplete="off" type="text" {...props} />
    </div>
  )
}

export default SidebarInput;
