import { ReactNode } from 'react';
import Button from '@components/button';
import useStartAccountLink from '@hooks/use-account-link';
import styles from './index.module.css';

interface AccountLinkButtonProps {
  children: ReactNode;
  // The Shopping List panel and the /account module frame this differently -
  // one is a quiet aside on an empty page, the other a module in a grid of
  // them - so the surrounding copy belongs to each page rather than to a
  // `variant` prop here. What is shared is the part with behaviour in it: the
  // click, the in-flight state, and what to say when starting fails.
  style?: 'primary' | 'danger';
}

// The one control that starts account linking recovery, wherever it is offered.
//
// **A button and not a link**, which matters more than it looks: clicking it
// writes a nonce into this browser's storage and issues a token *before*
// navigating to Auth0 (see `hooks/use-account-link.ts`). A plain link would
// skip both, and the flow would fail at the last step with nothing to say why.
//
// It deliberately says nothing about *which* account the person might have.
// Answering that would mean telling somebody, on a page they reached by signing
// up ten seconds ago, whether a given address already exists here - which is
// the account-enumeration oracle `specs/account-linking-recovery.md` refuses to
// build, and the same reason the server's refusals never name a provider.
const AccountLinkButton = ({ children, style = 'primary' }: AccountLinkButtonProps) => {
  const start = useStartAccountLink();

  return (
    <>
      <Button
        style={style}
        onClick={() => start.mutate()}
        disabled={start.isPending}
      >
        {start.isPending ? 'One moment…' : children}
      </Button>
      { start.isError && (
        <p className={styles.error} role="alert">
          We could not start that just now. Please try again.
        </p>
      )}
    </>
  );
};

export default AccountLinkButton;
