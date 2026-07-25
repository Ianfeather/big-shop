import styles from './index.module.css';
import icons from '@components/svg';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

// Manual dismiss only, deliberately - see ADR-0003: a save confirmation that
// auto-hides risks vanishing before a user who's looked away notices it.
const Toast = ({ message, onDismiss }: ToastProps) => {
  const CrossIcon = icons.cross;
  return (
    <div className={styles.toast} role="status">
      <span>{message}</span>
      <button className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
        <CrossIcon className={styles.icon} />
      </button>
    </div>
  );
}

export default Toast;
