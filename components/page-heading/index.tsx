import { ReactNode } from 'react';
import styles from './index.module.css';

interface PageHeadingProps {
  // The page title.
  children: ReactNode;
  subheading?: ReactNode;
  // Rendered at the right-hand end of the masthead, on the title's baseline -
  // the page's one contextual action (Edit, Cancel edits, Clear list).
  action?: ReactNode;
}

// The Shopping List's masthead, generalised: serif title, tight tracking, and
// a heavy ink rule under it. It was the only page dressed this way, which made
// every other page look like it belonged to a different product.
const PageHeading = ({ children, subheading, action }: PageHeadingProps) => (
  <div className={styles.masthead}>
    <div className={styles.titleBlock}>
      <h1 className={styles.title}>{children}</h1>
      { subheading && <p className={styles.subheading}>{subheading}</p> }
    </div>
    { action && <div className={styles.action}>{action}</div> }
  </div>
);

export default PageHeading;
