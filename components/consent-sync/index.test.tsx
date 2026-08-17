import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConsentSync from './index';
import { POLICY_VERSION, readConsentRecord, writeConsent } from '../../lib/consent';
import type { User } from '../../types/models';

// The reconcile, which is the riskiest logic in the consent work: it is the one
// place where two independently-held decisions have to be resolved into one,
// and getting it wrong loses a real answer silently rather than erroring.

const apiPost = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiPost }));

const mockUser = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-user', () => ({ default: mockUser }));

vi.mock('@hooks/use-auth', () => ({
  default: () => ({ isAuthenticated: true, getAccessTokenSilently: async () => 'token' }),
}));

function renderSync() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConsentSync />
    </QueryClientProvider>
  );
}

function serverUser(consent?: User['consent']): User {
  return { email: 'dev@localhost', consent } as User;
}

const AGES_AGO = '2020-01-01T00:00:00.000Z';
const RECENTLY = '2026-08-17T09:00:00.000Z';
const LATER = '2026-08-17T18:00:00.000Z';

beforeEach(() => {
  window.localStorage.clear();
  apiPost.mockReset();
  apiPost.mockResolvedValue(serverUser());
  mockUser.mockReset();
});

describe('ConsentSync', () => {
  it('does nothing when neither side has a decision', async () => {
    mockUser.mockReturnValue(serverUser(undefined));
    renderSync();

    await waitFor(() => expect(apiPost).not.toHaveBeenCalled());
    expect(readConsentRecord()).toBeNull();
  });

  // The case the component exists for.
  it('carries a decision made while logged out up to the server', async () => {
    writeConsent('granted', 'banner', RECENTLY);
    mockUser.mockReturnValue(serverUser(undefined));

    renderSync();

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/consent', 'token', {
        analytics: true,
        policyVersion: POLICY_VERSION,
        // The control the person actually used, kept through the carry-in.
        // created_at on the row already says we only learned it now.
        source: 'banner',
      })
    );
  });

  it('adopts the server decision when this browser has none', async () => {
    mockUser.mockReturnValue(
      serverUser({ analytics: true, policyVersion: POLICY_VERSION, decidedAt: RECENTLY })
    );

    renderSync();

    await waitFor(() => expect(readConsentRecord()?.analytics).toBe('granted'));
    // Adopted, not re-announced: nothing changed on the server.
    expect(apiPost).not.toHaveBeenCalled();
    // Stamped with the server's time, so this device does not now look like the
    // newest answer everywhere and start a ping-pong with the one that decided.
    expect(readConsentRecord()?.decidedAt).toBe(RECENTLY);
  });

  it('does nothing when the two already agree', async () => {
    writeConsent('denied', 'banner', RECENTLY);
    mockUser.mockReturnValue(
      serverUser({ analytics: false, policyVersion: POLICY_VERSION, decidedAt: RECENTLY })
    );

    renderSync();

    await waitFor(() => expect(apiPost).not.toHaveBeenCalled());
  });

  it('pushes the local decision when it is clearly the newer one', async () => {
    writeConsent('denied', 'settings', LATER);
    mockUser.mockReturnValue(
      serverUser({ analytics: true, policyVersion: POLICY_VERSION, decidedAt: RECENTLY })
    );

    renderSync();

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][2]).toMatchObject({ analytics: false });
  });

  it('takes the server decision when it is clearly the newer one', async () => {
    writeConsent('granted', 'banner', RECENTLY);
    mockUser.mockReturnValue(
      serverUser({ analytics: false, policyVersion: POLICY_VERSION, decidedAt: LATER })
    );

    renderSync();

    await waitFor(() => expect(readConsentRecord()?.analytics).toBe('denied'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  // The regression a clock-skew tie-break introduced and this pins shut. A
  // deliberate change made moments after the recorded one - decide on the
  // marketing page, sign in seconds later; or accept and immediately think
  // better of it - is two decisions a few seconds apart, and anything that
  // refuses to order them throws the newer one away and silently reinstates
  // the old. Seconds apart has to behave exactly like hours apart.
  it.each([
    ['an acceptance made seconds after a recorded decline', 'granted', false, true],
    ['a withdrawal made seconds after a recorded acceptance', 'denied', true, false],
  ] as const)('honours %s', async (_label, localDecision, serverAnalytics, expectedPush) => {
    writeConsent(localDecision, 'settings', '2026-08-17T09:00:02.000Z');
    mockUser.mockReturnValue(
      serverUser({
        analytics: serverAnalytics,
        policyVersion: POLICY_VERSION,
        decidedAt: '2026-08-17T09:00:00Z',
      })
    );

    renderSync();

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][2]).toMatchObject({ analytics: expectedPush });
    expect(readConsentRecord()?.analytics).toBe(localDecision);
  });

  // The regression that defeats the whole point of storing policy_version: a
  // consent given against superseded text is not a current decision, and
  // adopting it would silently dismiss the banner the version bump just raised.
  it('ignores a server decision made against an older policy version', async () => {
    mockUser.mockReturnValue(
      serverUser({ analytics: true, policyVersion: '2020-01-01', decidedAt: AGES_AGO })
    );

    renderSync();

    await waitFor(() => expect(apiPost).not.toHaveBeenCalled());
    // Nothing adopted, so the banner still has a question to ask.
    expect(readConsentRecord()).toBeNull();
  });

  it('pushes a current decision over a superseded server one', async () => {
    writeConsent('denied', 'banner', RECENTLY);
    mockUser.mockReturnValue(
      serverUser({ analytics: true, policyVersion: '2020-01-01', decidedAt: AGES_AGO })
    );

    renderSync();

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][2]).toMatchObject({
      analytics: false,
      policyVersion: POLICY_VERSION,
    });
  });

  // ConsentSync sits inside InnerApp, which is not rendered on the public
  // routes - so every trip between /privacy and /list remounts it. The
  // reconcile has to be safe to run any number of times rather than relying on
  // a "have I run yet" flag, which a remount resets.
  it('does not re-post on remount once the two agree', async () => {
    writeConsent('granted', 'banner', RECENTLY);
    mockUser.mockReturnValue(serverUser(undefined));

    const first = renderSync();
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    first.unmount();

    // The server now holds it, which is what the real cache would reflect.
    mockUser.mockReturnValue(
      serverUser({ analytics: true, policyVersion: POLICY_VERSION, decidedAt: RECENTLY })
    );
    renderSync();

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  });
});
