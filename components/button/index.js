import Link from 'next/link';
import icons from '@components/svg';
import styles from './index.module.css';

const Button = ({ className = '', onClick, children, href, icon, style, ...props}) => {
  const classes = `${styles.button} ${className} ${styles[style]}`;
  const IconElement = icon && icons[icon];

  if (href) {
    return (
      <Link href={href}>
        <a className={classes}>
          { icon &&  <IconElement className={styles.svg} /> }
          {children}
        </a>
      </Link>
    )
  }

  return (
    <button className={classes} onClick={onClick}>
      { icon &&  <IconElement className={styles.svg} /> }
      {children}
    </button>
  )
}

export default Button;
