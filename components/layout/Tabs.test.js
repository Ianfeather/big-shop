import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tabs from './Tabs';

describe('Tabs', () => {
  it('renders all children unconditionally above the max width', () => {
    window.innerWidth = 1200;
    render(
      <Tabs maxWidth={800}>
        <div name="First">First content</div>
        <div name="Second">Second content</div>
      </Tabs>
    );

    expect(screen.getByText('First content')).toBeInTheDocument();
    expect(screen.getByText('Second content')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders tab buttons and only the selected child below the max width', async () => {
    window.innerWidth = 500;
    render(
      <Tabs maxWidth={800}>
        <div name="First">First content</div>
        <div name="Second">Second content</div>
      </Tabs>
    );

    expect(screen.getByText('First content')).toBeInTheDocument();
    expect(screen.queryByText('Second content')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Second' }));

    expect(screen.queryByText('First content')).not.toBeInTheDocument();
    expect(screen.getByText('Second content')).toBeInTheDocument();
  });
});
