import icons from '@components/svg';
import { getTagMeta } from '@components/tag-pill/tag-meta';
import styles from './index.module.css';

const ListItem = ({ id, name, tags = [], checked = false, onClick}) => {
  const className = `${styles.listItem} ${checked ? styles.checked : ''}`;
  return (
    <li key={id} className={className}>
      <label htmlFor={id}>
        <span className={styles.name}>{name}</span>
        {
          !!tags.length && (
            <span className={styles.tagDots}>
              {
                tags.map(tag => {
                  const { icon, color } = getTagMeta(tag);
                  const Icon = icons[icon];
                  return (
                    <span className={styles.tagDot} style={{ '--tag-color': color }} key={tag} title={tag}>
                      <Icon className={styles.tagDotIcon} />
                    </span>
                  );
                })
              }
            </span>
          )
        }
        <input type="checkbox" id={id} className={styles.hidden} onChange={onClick}/>
      </label>
    </li>
  );
};

export default ListItem;
