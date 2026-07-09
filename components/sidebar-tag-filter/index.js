import TagPill from '@components/tag-pill';
import useOverflow from '@hooks/use-overflow';
import styles from './index.module.css';

const SidebarTagFilter = ({ onChange, tags, value }) => {
  const [containerRef, isOverflowing] = useOverflow([tags.length]);
  const containerClasses = `${styles.container} ${isOverflowing ? styles.overflowing : ''}`;

  return (
    <div className={containerClasses} ref={containerRef}>
      <button className={`${styles.allPill} ${value === '' ? styles.selected : ''}`} onClick={() => onChange('')}>All</button>
      {
        tags.map(tag => (
          <TagPill key={tag} tag={tag} selected={value === tag} onClick={() => onChange(tag)} />
        ))
      }
    </div>
  )
}

export default SidebarTagFilter;
