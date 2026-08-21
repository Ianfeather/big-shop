import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Invite from './index';
// The class name is hashed by the CSS-modules transform (vitest.config.js sets
// css: true), so the literal 'highlighted' never appears in the DOM. Assert
// against the same mapping the component uses.
import styles from './index.module.css';

describe('Invite', () => {
  it('shows the account holder and fires accept/reject callbacks', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<Invite token="fake-token" account_holder="Jane" onAccept={onAccept} onReject={onReject} />);

    expect(screen.getByText('Jane:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Accept/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /Reject/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // The highlight is how somebody arriving from an emailed link finds the right
  // invitation when the account holds more than one. /account names the inviter
  // in a toast; without this the name resolves to nothing on screen.
  it('is not highlighted by default', () => {
    const { container } = render(
      <Invite token="fake-token" account_holder="Jane" onAccept={vi.fn()} onReject={vi.fn()} />
    );
    expect(container.firstChild).not.toHaveClass(styles.highlighted);
  });

  it('is highlighted when it is the one an emailed link pointed at', () => {
    const { container } = render(
      <Invite token="fake-token" account_holder="Jane" highlighted onAccept={vi.fn()} onReject={vi.fn()} />
    );
    expect(container.firstChild).toHaveClass(styles.highlighted);
  });
});
