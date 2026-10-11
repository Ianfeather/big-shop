import { ReactNode } from 'react';
import Button from '@components/button';
import Message from '@components/message';
import { useStartAccountLink } from '@hooks/use-account-link';

interface AccountLinkButtonProps {
  // The label. The Shopping List panel and the /account module frame this
  // differently - one is a quiet aside on an otherwise empty page, the other a
  // module in a grid of them - so the surrounding copy belongs to each page
  // rather than to a `variant` prop here. What is shared is the part with
  // behaviour in it: the click, the in-flight state, and what to say when
  // starting fails.
  children: ReactNode;
  // Pass-through to the underlying Button, with no default of its own.
  // pages/account.tsx passes `style="primary"` explicitly; pages/list.tsx's
  // quiet secondary line (specs/onboarding.md's Stage 1: "drops from a
  // headline prompt to one quiet secondary line") deliberately passes
  // neither, relying on its own className instead. A default here would make
  // that second caller unable to opt out of it.
  style?: 'primary' | 'danger';
  className?: string;
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
// the account-enumeration oracle `specs/completed/account-linking-recovery.md` refuses to
// build, and the same reason the server's refusals never name a provider.
const AccountLinkButton = ({ children, style, className }: AccountLinkButtonProps) => {
  const start = useStartAccountLink();

  return (
    <>
      <Button
        style={style}
        className={className}
        onClick={() => start.mutate()}
        disabled={start.isPending}
      >
        {start.isPending ? 'One moment…' : children}
      </Button>
      { start.isError && (
        <Message status="error" message="We could not start that just now. Please try again." />
      )}
    </>
  );
};

export default AccountLinkButton;
