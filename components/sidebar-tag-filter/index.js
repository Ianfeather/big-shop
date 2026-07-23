import { useState } from 'react';
import icons from '@components/svg';
import TagPill from '@components/tag-pill';
import styles from './index.module.css';

const FilterIcon = icons.filter;

const SidebarTagFilter = ({ onChange, tags, value }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedCount = value.length;

  return (
    <>
      <div className={styles.toggleRow}>
        <button
          type="button"
          className={`${styles.toggle} ${selectedCount > 0 ? styles.toggleActive : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={selectedCount > 0 ? `Filter (${selectedCount} selected)` : 'Filter'}
        >
          <FilterIcon className={styles.toggleIcon} />
          { selectedCount > 0 && <span className={styles.count}>({selectedCount})</span> }
        </button>
      </div>
      {
        isOpen && (
          <div className={styles.tagGrid}>
            <button className={`${styles.allPill} ${selectedCount === 0 ? styles.selected : ''}`} onClick={() => onChange('')}>All</button>
            {
              tags.map(tag => (
                <TagPill key={tag} tag={tag} selected={value.includes(tag)} onClick={() => onChange(tag)} />
              ))
            }
          </div>
        )
      }
    </>
  )
}

export default SidebarTagFilter;
