import { ReactNode } from 'react';
import styles from './index.module.css';

interface SidebarHeadingProps {
  children: ReactNode;
  tone?: 'default' | 'tinted';
  className?: string;
}

const SidebarHeading = ({ children, tone = 'default', className: extraClassName = '' }: SidebarHeadingProps) => {
  const className = `${styles.heading} ${tone === 'tinted' ? styles.tinted : ''} ${extraClassName}`;
  return (
    <h4 className={className}>{children}</h4>
  )
}

export default SidebarHeading;
