import { useState } from 'react';
import icons from '@components/svg';
import TagPill from '@components/tag-pill';
import styles from './index.module.css';

const FilterIcon = icons.filter;

const SidebarTagFilter = ({ onChange, tags, value }) => {
  const [isOpen, setIsOpen] = useState(false);
  const hasActiveFilter = value !== '';

  const selectTag = (tag) => {
    onChange(tag);
    setIsOpen(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.toggleRow}>
        <button
          type="button"
          className={`${styles.toggle} ${hasActiveFilter ? styles.toggleActive : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          <FilterIcon className={styles.toggleIcon} />
          Filter
        </button>
        {
          hasActiveFilter && !isOpen && (
            <TagPill tag={value} selected className={styles.activeTag} onClick={() => selectTag('')} />
          )
        }
      </div>
      {
        isOpen && (
          <div className={styles.tagGrid}>
            <button className={`${styles.allPill} ${value === '' ? styles.selected : ''}`} onClick={() => selectTag('')}>All</button>
            {
              tags.map(tag => (
                <TagPill key={tag} tag={tag} selected={value === tag} onClick={() => selectTag(tag)} />
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default SidebarTagFilter;
