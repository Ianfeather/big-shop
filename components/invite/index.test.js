import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Invite from './index';

describe('Invite', () => {
  it('shows the account holder and fires accept/reject callbacks', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<Invite account_holder="Jane" onAccept={onAccept} onReject={onReject} />);

    expect(screen.getByText('Jane:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Accept/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /Reject/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
