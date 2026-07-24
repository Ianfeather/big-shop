import { CSSProperties, MouseEventHandler } from 'react';
import icons from '@components/svg';
import { getTagMeta } from './tag-meta';
import styles from './index.module.css';

interface TagPillProps {
  tag: string;
  selected?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

const TagPill = ({ tag, selected = false, onClick, className = '' }: TagPillProps) => {
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
      <button type="button" className={classes} style={{ '--tag-color': color } as CSSProperties} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className={classes} style={{ '--tag-color': color } as CSSProperties}>
      {content}
    </span>
  );
};

export default TagPill;
