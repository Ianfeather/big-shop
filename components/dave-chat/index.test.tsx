import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DaveChat from './index';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DaveChat', () => {
  it('renders messages labelled by role, and a typing indicator while loading', () => {
    render(
      <DaveChat
        messages={[
          { id: 1, role: 'user', content: 'Hi Dave', timestamp: '2024-01-01T10:00:00Z' },
          { id: 2, role: 'assistant', content: 'Hello!', timestamp: '2024-01-01T10:00:05Z' }
        ]}
        onSendMessage={() => {}}
        isLoading={true}
      />
    );

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getAllByText('Dave')).toHaveLength(2); // assistant message header + typing indicator header
    expect(screen.getByText('Hi Dave')).toBeInTheDocument();
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('submits trimmed input and clears the field, but not while loading', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(<DaveChat messages={[]} onSendMessage={onSendMessage} isLoading={false} />);

    const textarea = screen.getByPlaceholderText(/ask dave/i);
    await userEvent.type(textarea, '  what should I cook?  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSendMessage).toHaveBeenCalledWith('what should I cook?');
    expect(textarea).toHaveValue('');

    rerender(<DaveChat messages={[]} onSendMessage={onSendMessage} isLoading={true} />);
    expect(screen.getByPlaceholderText(/ask dave/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('disables the send button until there is non-whitespace input', async () => {
    render(<DaveChat messages={[]} onSendMessage={() => {}} isLoading={false} />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/ask dave/i), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
