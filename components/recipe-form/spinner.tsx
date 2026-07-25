import { ReactNode } from 'react';
import styles from './spinner.module.css';

// className/children are accepted (callers pass both) but ignored - the
// spinner always renders the same regardless. Pre-existing, not fixed here.
const Spinner = (_props: { className?: string; children?: ReactNode }) => <div className={styles.spinner}><div></div><div></div><div></div><div></div></div>

export default Spinner;
