import styles from './index.module.css';

const SidebarInput = (props) => {
  return (
    <input className={styles.input} autoComplete="off" type="text" {...props} />
  )
}

export default SidebarInput;
