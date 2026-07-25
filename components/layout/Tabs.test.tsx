import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tabs from './Tabs';

// Tabs reads a `name` prop off each child (see Tabs.tsx) — not a real HTML
// attribute, so it's passed via spread + cast rather than as a literal JSX
// attribute, which TS would reject on an intrinsic <div>.
const namedDiv = (name: string, children: string) => (
  <div {...{ name } as { name: string }}>{children}</div>
);

describe('Tabs', () => {
  it('renders all children unconditionally above the max width', () => {
    window.innerWidth = 1200;
    render(
      <Tabs maxWidth={800}>
        {namedDiv('First', 'First content')}
        {namedDiv('Second', 'Second content')}
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
        {namedDiv('First', 'First content')}
        {namedDiv('Second', 'Second content')}
      </Tabs>
    );

    expect(screen.getByText('First content')).toBeInTheDocument();
    expect(screen.queryByText('Second content')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Second' }));

    expect(screen.queryByText('First content')).not.toBeInTheDocument();
    expect(screen.getByText('Second content')).toBeInTheDocument();
  });
});
