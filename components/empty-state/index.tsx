import { ComponentType, ReactNode, SVGProps } from 'react';
import styles from './index.module.css';

interface EmptyStateProps {
  // Taken as a component rather than as rendered children so this owns the
  // illustration's size at every breakpoint - which is the whole reason the
  // Shopping List and Recipes share this instead of each styling its own.
  illustration: ComponentType<SVGProps<SVGSVGElement>>;
  illustrationLabel: string;
  title: string;
  children?: ReactNode;
}

// Illustration beside a line of copy, becoming a centred stack on a phone.
// Deliberately not centred in the middle of the page at desktop widths: a
// full-width illustration left a screen-high void on whichever page was empty,
// which for the Shopping List is most of the week.
const EmptyState = ({ illustration: Illustration, illustrationLabel, title, children }: EmptyStateProps) => (
  <div className={styles.emptyState}>
    <Illustration className={styles.illustration} role="img" aria-label={illustrationLabel} />
    <div className={styles.copy}>
      <p className={styles.title}>{title}</p>
      { children && <p className={styles.hint}>{children}</p> }
    </div>
  </div>
);

export default EmptyState;
