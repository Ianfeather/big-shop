import { MouseEventHandler, ReactNode } from 'react';
import Link from 'next/link';
import icons from '@components/svg';
import styles from './index.module.css';

// Renders as either a Next Link (href given) or a <button>, spreading ...rest
// onto whichever one — a precise discriminated-union type for that would cost
// more than it's worth here, so the rest props stay loosely typed.
interface ButtonProps {
  className?: string;
  onClick?: MouseEventHandler;
  children?: ReactNode;
  href?: string;
  icon?: string;
  // Only 'primary'/'danger' exist as classes in index.module.css - a
  // mismatched value here silently produces the literal string "undefined"
  // in the rendered className (styles[style] on a missing key) rather than
  // failing, so this is typed narrowly instead of as `string`.
  style?: 'primary' | 'danger';
  // Outline is the default. Buttons in this app are actions on a sheet of
  // paper, and a page of solid blocks was the thing the "Cookbook" work set
  // out to lose - so a solid fill is now the exception a call site has to ask
  // for (`outline={false}`), not what you get by not thinking about it.
  outline?: boolean;
  iconOnly?: boolean;
  [key: string]: unknown;
}

const Button = ({ className = '', onClick, children, href, icon, style, outline = true, iconOnly = false, ...rest }: ButtonProps) => {
  let classes = `${styles.button} ${className} ${style ? styles[style] : ''}`;
  if (outline) {
    classes += ` ${styles['outline']}`
  }
  if (iconOnly) {
    classes += ` ${styles['iconOnly']}`
  }
  const IconElement = icon ? icons[icon] : undefined;

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        { IconElement &&  <IconElement className={styles.svg} /> }
        {children}
      </Link>
    )
  }

  return (
    <button className={classes} onClick={onClick} {...rest}>
      { IconElement &&  <IconElement className={styles.svg} /> }
      {children}
    </button>
  )
}

export default Button;
