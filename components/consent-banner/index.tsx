import { ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './index.module.css';
import useConsent from '@hooks/use-consent';
import { ConsentDecision } from '../../lib/consent';

// The cookie banner, and the way anything on the page re-opens it.
//
// Two categories, essential and analytics; essential is *stated* rather than
// offered, because it is not a choice and a permanently-disabled toggle beside
// a real one is theatre.
//
// **Mounted outside the auth gate** (see pages/_app.tsx) and reads only
// synchronous localStorage, so it never waits on anything. Deliberate:
// follow-ups.md #58 records that the homepage already shows three states while
// the Auth0 SDK resolves, and a banner that waited on a network call would add
// a fourth flash to the one screen that has to look composed.
//
// **No "reject all" behind a second click.** Accept and Decline are the same
// size, the same shape, one tap apart. A banner where declining costs more
// effort than accepting is a dark pattern the ICO calls out by name, and the
// consent it collects is worth nothing anyway.

// Opens the banner again after a decision has been made. Defaults to a no-op so
// a component rendered outside the provider (a test, a Storybook-ish harness)
// doesn't explode - the control simply does nothing, which is the failure mode
// you want for a settings link.
const OpenSettingsContext = createContext<() => void>(() => {});

// For the "Cookie settings" control in the footers. Withdrawal has to be as
// easy as granting was, which means the same UI has to be reachable *after* a
// decision, not only before one.
export function useCookieSettings(): () => void {
  return useContext(OpenSettingsContext);
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [forcedOpen, setForcedOpen] = useState(false);

  const openSettings = useCallback(() => setForcedOpen(true), []);
  const close = useCallback(() => setForcedOpen(false), []);

  return (
    <OpenSettingsContext.Provider value={openSettings}>
      {children}
      <Banner forcedOpen={forcedOpen} onClose={close} />
    </OpenSettingsContext.Provider>
  );
}

function Banner({ forcedOpen, onClose }: { forcedOpen: boolean; onClose: () => void }) {
  const [consent, decide] = useConsent();

  // What was chosen in this page's lifetime, which is not always the same thing
  // as what got stored.
  //
  // **This is what makes the banner dismissable in a browser with site data
  // blocked**, and without it the banner is a trap for exactly the most
  // privacy-conscious visitor. There, `writeConsent` throws internally and
  // swallows it, so `readConsent` keeps answering `unset` - and since `unset`
  // is precisely the state that shows the banner, both buttons appear to do
  // nothing, forever. hooks/use-local-storage-flag.ts never hits this because
  // its fallback is a usable default; here the fallback *is* the "keep asking"
  // state, so the decision has to be remembered somewhere that cannot fail.
  //
  // It cannot survive a reload, and that is the honest outcome: with no storage
  // there is nowhere to put it, so the question is asked again next visit. What
  // it must not do is refuse to go away now.
  const [decidedHere, setDecidedHere] = useState<ConsentDecision | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Unique per mount rather than a hardcoded string: two providers on one page
  // would otherwise emit the same id twice and aria-labelledby would resolve to
  // whichever came first.
  const headingId = useId();

  const decided = consent !== 'unset' || decidedHere !== null;
  const showing = forcedOpen || !decided;

  // Focus moves into the panel **only when it was deliberately re-opened**, and
  // that asymmetry is the point.
  //
  // On a first visit the banner appears unbidden, so pulling focus out of the
  // page would hijack a reader who came to read; it is not modal and is meant
  // to be ignorable until answered. But "Cookie settings" is an explicit
  // request for it, and a keyboard or screen-reader user who presses that
  // currently gets nothing announced and no obvious way in - the dialog renders
  // last in the DOM, far from the footer button they just pressed.
  useEffect(() => {
    if (forcedOpen) panel.current?.focus();
  }, [forcedOpen]);

  // Escape closes the re-opened panel, restoring the state it was in. It
  // deliberately does *not* dismiss a first-visit banner: leaving without
  // answering has to stay "unanswered", and treating a keypress as a decision
  // is exactly the implicit consent this whole thing exists to avoid.
  useEffect(() => {
    if (!forcedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [forcedOpen, onClose]);

  if (!showing) return null;

  function choose(decision: ConsentDecision) {
    // Re-opened deliberately means this is a change of mind; appearing on its
    // own means it is the first answer. The server record keeps the two apart,
    // which is what makes "when did they change it, and from what" answerable.
    decide(decision, forcedOpen ? 'settings' : 'banner');
    setDecidedHere(decision);
    // Always close, including when the decision did not change. Re-opening via
    // Cookie settings and pressing the button you already chose has to dismiss
    // the panel - otherwise the only way out is to pick the other one, which is
    // a trap rather than a settings screen.
    onClose();
  }

  return (
    // role="dialog" so it is announced as something wanting an answer.
    // Deliberately NOT modal: no focus trap, nothing blocked. Someone must be
    // able to read the site - and the privacy policy it links to - before
    // deciding. A cookie wall that blocks reading is precisely what teaches
    // people to click Accept to make it go away.
    <div
      ref={panel}
      className={styles.banner}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      // Focusable only as a target for the re-open above - not in the tab
      // order, so it never becomes a stop a reader has to pass through.
      tabIndex={-1}
    >
      <div className={styles.inner}>
        <div className={styles.copy}>
          <h2 id={headingId} className={styles.heading}>Cookies</h2>
          <p className={styles.body}>
            Big Shop stores a few things on your device just to work &mdash; keeping you logged in,
            remembering how you like your list. Analytics is separate, and optional: it counts how
            the site is used, and none of it loads unless you say yes.
          </p>
          <p className={styles.body}>
            <Link href="/privacy" className={styles.link}>What we store, and who else sees it</Link>
          </p>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.action} ${styles.decline}`}
            onClick={() => choose('denied')}
          >
            Decline analytics
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.accept}`}
            onClick={() => choose('granted')}
          >
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
