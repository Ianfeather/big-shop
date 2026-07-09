import icons from '@components/svg';
import { getTagMeta } from './tag-meta';
import styles from './index.module.css';

const TagPill = ({ tag, selected = false, onClick, className = '' }) => {
  const { icon, color } = getTagMeta(tag);
  const Icon = icons[icon];
  const classes = `${styles.pill} ${selected ? styles.selected : ''} ${className}`;

  const content = (
    <>
      <Icon className={styles.icon} />
      {tag}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} style={{ '--tag-color': color }} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className={classes} style={{ '--tag-color': color }}>
      {content}
    </span>
  );
};

export default TagPill;
