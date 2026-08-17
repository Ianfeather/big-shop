import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import useAuth from '@hooks/use-auth';
import useConsent from '@hooks/use-consent';
import useUser from '@hooks/use-user';
import { apiPost } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';
import {
  ConsentRecord,
  ConsentSource,
  POLICY_VERSION,
  readConsentRecord,
  writeConsent,
} from '../../lib/consent';
import type { User } from '../../types/models';

// Carries the browser's consent decision to the server, and the server's back.
//
// Renders nothing. It exists as a component rather than a hook called from
// somewhere convenient because of where it has to sit: the banner is mounted
// outside both QueryClientProvider and Auth0Provider (see pages/_app.tsx, and
// the reasons there), so it cannot use react-query or know who is signed in.
// This is the other half, mounted *inside* the gate, which can.
//
// The arrangement is hooks/use-synced-flag.ts's, one layer up: localStorage is
// the paint source and answers instantly, the server is the source of truth and
// wins when it disagrees. What differs is that a consent decision is not a view
// preference - it is a record, and the server's copy is append-only - so this
// never "corrects" the server to match the browser. It only ever adds.
//
// **The anonymous case is the normal one.** Most decisions are taken on the
// marketing page by someone with no account, and are honoured entirely from
// localStorage. This is what happens when such a person later signs up: their
// existing answer is carried in rather than being asked again.

// A decision's identity for comparison purposes. Two decisions are the same
// fact if they agree on the answer *and* on which policy text it was against.
function identity(analytics: boolean, version: string): string {
  return `${analytics}:${version}`;
}

// Which of two conflicting decisions to keep: the more recent one, full stop.
//
// **A skew tolerance that broke ties towards `denied` was tried here and
// removed**, and the reason is worth keeping so it is not reintroduced. The
// argument for it is sound in the abstract - `decidedAt` is the visitor's clock
// and the server's is the database's, and a fast local clock could in principle
// re-push a stale grant over a withdrawal made minutes earlier on another
// device, which is the one outcome this feature exists to prevent.
//
// What it actually did was discard real answers. Any deliberate change made
// within the window - accept, then think better of it and decline a minute
// later, or the far more common "decide on the marketing page, then sign in
// seconds later" - is *also* two decisions a few seconds apart, and the
// tie-break threw the newer one away and silently reinstated the old. An e2e
// test caught it doing exactly that to an acceptance. Protecting a rare
// cross-device race by breaking the primary flow is the wrong trade.
//
// So the residual risk is accepted and named: with a badly wrong client clock,
// one reconcile can pick the wrong decision. It self-corrects on the next
// explicit choice, and every synced decision carries the *server's* timestamp
// (see `adopt`), so the browser's clock only ever orders a decision this device
// has not yet reported.
function localWins(localAt: string, serverAt: string): boolean {
  return Date.parse(localAt) > Date.parse(serverAt);
}

export default function ConsentSync() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth();
  const user = useUser();
  // Subscribed to rather than read once: this re-renders when the banner writes
  // a decision, which is what makes a click reach the server without the two
  // components knowing about each other.
  const [consentState] = useConsent();
  const queryClient = useQueryClient();

  // The decision most recently sent, so a re-render does not send it again
  // while the first request is still in flight. It is only a de-duplicator for
  // one mount - the reconcile below is written to be idempotent, so losing this
  // on a remount is harmless.
  const inFlight = useRef<string | null>(null);

  const recordMutation = useMutation({
    mutationFn: async (record: ConsentRecord) => {
      const token = await getAccessTokenSilently();
      return apiPost<User>('/consent', token, {
        analytics: record.analytics === 'granted',
        policyVersion: record.version,
        source: record.source,
      });
    },
    // The response is the saved User, so the cache can take it directly rather
    // than invalidating and refetching - the same trick the pantry-staples
    // preference uses. It is also what makes the reconcile settle: the next
    // pass sees a server that already agrees.
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.user, saved),
    // A failed sync must not surface. The decision is already honoured locally,
    // the next load reconciles again, and a toast saying "we could not record
    // that you declined analytics" would be both alarming and useless.
    onError: (e) => console.error(e),
  });

  // **Idempotent by construction, rather than guarded by a "have I run yet"
  // flag.** The obvious shape here is a one-time reconcile on mount, and it is
  // wrong in this app: ConsentSync lives inside InnerApp, which pages/_app.tsx
  // does not render on the public routes - so every navigation between
  // /privacy and /list unmounts and remounts it, resetting any such flag. The
  // logic below instead asks only "do the two sides disagree?", which is safe
  // to answer any number of times: once they agree it does nothing at all.
  useEffect(() => {
    // `user` is undefined until GET /user resolves, and stays undefined for
    // someone who has never had POST /user run for them (use-user.ts treats the
    // 404 as a real state). Either way there is nobody to reconcile against.
    if (!isAuthenticated || !user) return;

    const local = readConsentRecord();

    // **A stored decision against superseded policy text is not a decision.**
    // The browser already applies this rule to its own copy (readConsent returns
    // `unset` for an old version, which is what re-asks after a material
    // change); the server's copy has to be held to it too. Without this, a
    // logged-out visitor correctly sees the banner after a policy bump and then
    // the first authenticated load silently adopts their superseded answer and
    // dismisses it - defeating the entire purpose of storing policy_version.
    const server =
      user.consent && user.consent.policyVersion === POLICY_VERSION ? user.consent : undefined;

    if (!local && !server) return;

    // Adopting: the server's decision becomes this browser's. Stamped with the
    // server's own timestamp rather than now, so this device does not then look
    // like the newest answer everywhere and start a ping-pong with the device
    // that actually made it. `login-sync` because that is how this browser came
    // to hold it - the server's row still carries how the human gave it.
    const adopt = (decision: { analytics: boolean; decidedAt: string }) =>
      writeConsent(decision.analytics ? 'granted' : 'denied', 'login-sync', decision.decidedAt);

    const send = (record: ConsentRecord, source: ConsentSource) => {
      const key = identity(record.analytics === 'granted', record.version);
      if (inFlight.current === key) return;
      inFlight.current = key;
      recordMutation.mutate({ ...record, source });
    };

    if (local && server) {
      const localKey = identity(local.analytics === 'granted', local.version);
      const serverKey = identity(server.analytics, server.policyVersion);
      if (localKey === serverKey) return;

      if (localWins(local.decidedAt, server.decidedAt)) {
        // The human's own control, not `login-sync`. This branch is reached
        // both by a change made in-app and by one carried in from a logged-out
        // visit, and `local.source` is truthful in both - it says which control
        // they used. When we *learned* it is already recorded, in created_at.
        send(local, local.source);
      } else {
        adopt(server);
      }
      return;
    }

    if (local) {
      // The case this component exists for: decided while logged out, now
      // signing in. Recorded with the control they actually used - created_at
      // already carries the fact that we only learned it now.
      send(local, local.source);
      return;
    }

    if (server) adopt(server);
    // recordMutation is recreated each render and including it would re-run this
    // on every mutation state transition, which is the loop `inFlight` exists to
    // prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, consentState]);

  return null;
}
