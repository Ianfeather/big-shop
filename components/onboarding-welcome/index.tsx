import Link from 'next/link';
import Button from '@components/button';
import AccountLinkButton from '@components/account-link';
import OpenBookIllustration from '@components/svg/open-book';
import styles from './index.module.css';

interface WelcomeProps {
  // How many sample-seeded starter Recipes the Account holds
  // (specs/completed/sample-seeded-accounts.md) - used only for the Combine
  // CTA's copy, so it reads correctly if the starter set's size ever changes
  // rather than naming a fixed "three" that could go stale.
  starterRecipeCount: number;
  // Ticks every starter Recipe and lets the existing shopping-list effect in
  // pages/list.tsx do the rest - this component owns no Recipe ids itself.
  onCombine: () => void;
  // accountLinkOffer === 'start': specs/onboarding.md's Stage 1 resolution.
  // The 'finish' case is unaffected by any of this and keeps its own full-
  // prominence notice in pages/list.tsx - it never reaches this component.
  showAccountLink: boolean;
}

// specs/onboarding.md's Stage 2: the welcome a brand-new /list shows in place
// of the generic "your shopping list is empty" copy, while the Account holds
// no Recipe it actually added itself (Stage 3's retirement condition - see
// pages/list.tsx for where that's computed). Two CTAs, Archive before
// Combine, a fixed order rather than a persona-dependent one (deferred -
// https://app.notion.com/p/3f6c724ecda1816ebed8ffb46e93204a). Repertoire
// gets a line, not a CTA: there's no usage history yet to show one.
const Welcome = ({ starterRecipeCount, onCombine, showAccountLink }: WelcomeProps) => (
  <div className={styles.welcome}>
    <div className={styles.intro}>
      <OpenBookIllustration className={styles.illustration} role="img" aria-label="An open recipe book" />
      <div className={styles.copy}>
        <p className={styles.title}>Let&rsquo;s get your first list going</p>
        <p className={styles.hint}>
          Tick what you&rsquo;re cooking and every ingredient lands here, added up
          and sorted into the order you walk the shop.
        </p>
      </div>
    </div>
    <div className={styles.ctas}>
      <div className={styles.cta}>
        <p className={styles.ctaCopy}>
          Photograph a page from a cookbook and it reads itself in.
        </p>
        <Button href="/recipes/new?source=camera" style="primary">Photograph a recipe</Button>
      </div>
      <div className={styles.cta}>
        <p className={styles.ctaCopy}>
          {starterRecipeCount}{' '}
          recipes are already in your collection &mdash; see their
          ingredients add up into one list.
        </p>
        <Button onClick={onCombine}>See them combine</Button>
      </div>
    </div>
    <p className={styles.repertoire}>
      The longer you use it, the smarter it gets &mdash; <Link href="/">see how</Link>.
    </p>
    { showAccountLink && (
      <p className={styles.accountLink}>
        Signed in before?{' '}
        <AccountLinkButton className={styles.accountLinkButton}>Link that account</AccountLinkButton>
      </p>
    )}
  </div>
);

export default Welcome;
