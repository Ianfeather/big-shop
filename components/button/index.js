import Link from 'next/link';
import icons from '@components/svg';
import styles from './index.module.css';

const Button = ({ className = '', onClick, children, href, icon, style, outline = false, iconOnly = false, ...rest }) => {
  let classes = `${styles.button} ${className} ${styles[style]}`;
  if (outline) {
    classes += ` ${styles['outline']}`
  }
  if (iconOnly) {
    classes += ` ${styles['iconOnly']}`
  }
  const IconElement = icon && icons[icon];

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        { icon &&  <IconElement className={styles.svg} /> }
        {children}
      </Link>
    )
  }

  return (
    <button className={classes} onClick={onClick} {...rest}>
      { icon &&  <IconElement className={styles.svg} /> }
      {children}
    </button>
  )
}

export default Button;
