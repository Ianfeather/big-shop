import styles from './index.module.css';

const SidebarTagFilter = ({ onChange, tags, value }) => {
  return (
    <div className={styles.container}>
      <button className={`${styles.btn} ${value=='' ? styles.selected : ''}`} onClick={() => onChange('')}>All</button>
      {
        tags.map(tag => (
          <button key={tag} className={`${styles.btn} ${value==tag ? styles.selected : ''}`} onClick={(e) => onChange(e.target.innerText)}>{tag}</button>
        ))
      }
    </div>
  )
}

export default SidebarTagFilter;
