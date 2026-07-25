import { ChangeEventHandler, CSSProperties } from 'react';
import icons from '@components/svg';
import { getTagMeta } from '@components/tag-pill/tag-meta';
import styles from './index.module.css';

// Off for now - not happy with how these read in the list, may revisit.
const showTagIcons = process.env.NEXT_PUBLIC_SHOW_TAG_ICONS === 'true';

interface ListItemProps {
  id: string | number;
  name: string;
  tags?: string[];
  checked?: boolean;
  onClick?: ChangeEventHandler<HTMLInputElement>;
  variant?: 'panel' | 'chip';
}

const ListItem = ({ id, name, tags = [], checked = false, onClick, variant = 'panel' }: ListItemProps) => {
  const domId = String(id);
  const className = `${styles.listItem} ${styles[variant]} ${checked ? styles.checked : ''}`;
  return (
    <li key={id} className={className}>
      <label htmlFor={domId}>
        { (variant === 'chip' || checked) && <span className={styles.check} aria-hidden="true"></span> }
        <span className={styles.name}>{name}</span>
        {
          showTagIcons && !!tags.length && (
            <span className={styles.tagDots}>
              {
                tags.map(tag => {
                  const { icon, color } = getTagMeta(tag);
                  const Icon = icons[icon];
                  return (
                    <span className={styles.tagDot} style={{ '--tag-color': color } as CSSProperties} key={tag} title={tag}>
                      <Icon className={styles.tagDotIcon} />
                    </span>
                  );
                })
              }
            </span>
          )
        }
        <input type="checkbox" id={domId} className={styles.hidden} onChange={onClick}/>
      </label>
    </li>
  );
};

export default ListItem;
