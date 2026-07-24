import { ComponentType, InputHTMLAttributes, SVGProps } from 'react';
import styles from './index.module.css';

interface SidebarInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

const SidebarInput = ({ icon: Icon, ...props }: SidebarInputProps) => {
  return (
    <div className={styles.field}>
      {Icon && <Icon className={styles.icon} />}
      <input className={styles.input} autoComplete="off" type="text" {...props} />
    </div>
  )
}

export default SidebarInput;
