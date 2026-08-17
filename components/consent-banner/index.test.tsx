import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsentProvider, useCookieSettings } from './index';
import { readConsent, writeConsent } from '../../lib/consent';

// A stand-in for the footer control, so the re-open path is exercised the way
// the real pages use it rather than by poking the provider's internals.
function CookieSettingsLink() {
  const open = useCookieSettings();
  return <button onClick={open}>Cookie settings</button>;
}

function renderApp() {
  return render(
    <ConsentProvider>
      <CookieSettingsLink />
    </ConsentProvider>
  );
}

const banner = () => screen.queryByRole('dialog', { name: 'Cookies' });

beforeEach(() => {
  window.localStorage.clear();
});

describe('ConsentBanner', () => {
  it('appears for a visitor who has not been asked', () => {
    renderApp();
    expect(banner()).toBeInTheDocument();
  });

  it.each(['granted', 'denied'] as const)(
    'stays away for a visitor who already answered (%s)',
    (decision) => {
      writeConsent(decision);
      renderApp();
      expect(banner()).not.toBeInTheDocument();
    }
  );

  it('records the decision and dismisses itself on accept', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Accept analytics' }));

    expect(readConsent()).toBe('granted');
    expect(banner()).not.toBeInTheDocument();
  });

  it('records the decision and dismisses itself on decline', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Decline analytics' }));

    expect(readConsent()).toBe('denied');
    expect(banner()).not.toBeInTheDocument();
  });

  it('re-opens on demand so a decision can be withdrawn', async () => {
    const user = userEvent.setup();
    writeConsent('granted');
    renderApp();
    expect(banner()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(banner()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Decline analytics' }));
    expect(readConsent()).toBe('denied');
    expect(banner()).not.toBeInTheDocument();
  });

  // The trap in a re-openable panel: choosing what you already chose is not a
  // state change, so anything keyed on "the decision changed" leaves it stuck
  // open with no way out but picking the other option.
  it('closes when the re-opened panel is answered with the same choice', async () => {
    const user = userEvent.setup();
    writeConsent('granted');
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    await user.click(screen.getByRole('button', { name: 'Accept analytics' }));

    expect(readConsent()).toBe('granted');
    expect(banner()).not.toBeInTheDocument();
  });

  // Not modal, deliberately: someone has to be able to read the privacy policy
  // it links to before answering it.
  it('does not trap the page behind a modal', () => {
    renderApp();
    expect(banner()).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByRole('link', { name: /what we store/i })).toHaveAttribute('href', '/privacy');
  });

  // The regression this exists for: with storage blocked, writeConsent
  // swallows the failure and readConsent keeps answering `unset` - which is the
  // state that shows the banner. Before the component remembered the choice
  // itself, both buttons appeared to do nothing and the banner could not be
  // dismissed at all, for exactly the visitor who blocked storage on purpose.
  it('can still be dismissed when storage is blocked', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });

    renderApp();
    expect(banner()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Decline analytics' }));
    expect(banner()).not.toBeInTheDocument();

    setItem.mockRestore();
    getItem.mockRestore();
  });

  // Focus is pulled in only when the panel was asked for. On a first visit it
  // must not be, or the banner hijacks a reader who came to read.
  it('takes focus when reopened, but not when it appears unbidden', async () => {
    const user = userEvent.setup();
    renderApp();

    const firstVisit = banner();
    expect(firstVisit).toBeInTheDocument();
    expect(firstVisit).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Decline analytics' }));
    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));

    expect(banner()).toHaveFocus();
  });

  it('closes a reopened panel on Escape without recording a decision', async () => {
    const user = userEvent.setup();
    writeConsent('granted');
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(banner()).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(banner()).not.toBeInTheDocument();
    // Escape is "I did not want to change this", not a new answer.
    expect(readConsent()).toBe('granted');
  });

  // Escape must not dismiss the first-visit banner: leaving without answering
  // has to stay unanswered rather than being read as a decision.
  it('ignores Escape while the question is still unanswered', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.keyboard('{Escape}');

    expect(banner()).toBeInTheDocument();
    expect(readConsent()).toBe('unset');
  });

  it('gives declining the same prominence as accepting', () => {
    renderApp();
    const accept = screen.getByRole('button', { name: 'Accept analytics' });
    const decline = screen.getByRole('button', { name: 'Decline analytics' });

    // Both are real buttons in the same group - declining is not demoted to a
    // text link or hidden behind a "manage preferences" step.
    expect(decline.tagName).toBe(accept.tagName);
    expect(decline.parentElement).toBe(accept.parentElement);
  });
});
