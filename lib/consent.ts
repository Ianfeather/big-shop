// The privacy policy's version, and the vocabulary the consent machinery is
// built on.
//
// Small on purpose: this is the one fact the policy page, the consent banner
// and the stored consent record all have to agree on, so it lives in one place
// rather than being typed into three. See specs/completed/analytics-and-consent.md, whose
// Phase 2 records a `policy_version` against every decision precisely so a
// later material change can re-ask the people whose consent predates it.

// The version of the privacy policy currently published at /privacy.
//
// A date rather than a counter, because the question it answers is always
// "which text did they agree to", and a date is the only form of that answer
// which is legible without a changelog.
//
// **Bump this only for a change that would alter someone's decision** - a new
// recipient, a new purpose, a new category of data. Fixing a typo or rewording
// a sentence must not bump it, because bumping it is how the banner is put back
// in front of people who have already decided, and re-asking for no reason is
// how a consent prompt becomes something to click past without reading.
export const POLICY_VERSION = '2026-08-16';

// The same date, written for a reader rather than for a database column.
//
// Derived rather than typed out again: the version and the "last updated" line
// on /privacy are one fact, and hand-syncing two formats of it is how a page
// ends up claiming it was updated on a date its own version disagrees with.
export function policyLastUpdated(version: string = POLICY_VERSION): string {
  return new Date(`${version}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Whether the visitor has agreed to non-essential storage.
//
// **Three states, and `unset` is the load-bearing one.** It is what makes the
// banner appear, and collapsing it into `denied` - which looks like a
// simplification, since both mean "do not load analytics" - would make a
// visitor who declined indistinguishable from one who has never been asked, so
// they would be re-asked on every single visit. Declining has to stick, and it
// can only stick if "no" and "not yet" are different values.
export type ConsentState = 'unset' | 'granted' | 'denied';

// A decision is only ever `granted` or `denied`; `unset` is the absence of one.
export type ConsentDecision = Exclude<ConsentState, 'unset'>;

// How a decision was given - the "how" half of what a consent record has to
// carry, and the same three values migrations/034_consent_event.sql accepts.
//
// Recorded in the browser as well as on the server because it belongs to the
// decision rather than to the request that reported it: a choice made on the
// banner while logged out is still a banner choice when it is pushed up three
// days later at login, and `created_at` already carries the fact that we only
// learned it then. `login-sync` is for a row no control can be attributed to -
// a decision this browser adopted from the server, or one written by a harness
// or a back-fill.
export type ConsentSource = 'banner' | 'settings' | 'login-sync';

// Follows the `bigshop:<kebab-name>` convention already set by
// SHOW_STAPLES_KEY in components/shopping-list/ShoppingList.
//
// Exported because the e2e suite seeds a decision directly into localStorage
// before the app boots (see e2e/fixtures.ts) - it cannot call writeConsent,
// which needs a `window` that does not exist in the Playwright process. Sharing
// the constant is the same argument that makes it import POLICY_VERSION: a key
// spelled out by hand in the test harness silently stops matching the day this
// one changes, and the symptom is every spec failing on clicks the banner is
// covering rather than anything mentioning consent.
export const CONSENT_STORAGE_KEY = 'bigshop:consent';

// What actually goes in localStorage. The version travels *with* the decision
// rather than being checked separately, because the pair is the fact worth
// recording: not "they said yes" but "they said yes to this text".
interface StoredConsent {
  analytics: ConsentDecision;
  version: string;
  source: ConsentSource;
  // When the decision was made, RFC 3339. Not decoration: the server holds a
  // timestamp too, and reconciling without one means guessing which side is
  // newer - so either a decision just made here is discarded by a stale server
  // record, or a decision made on another device is stamped over by this one.
  // See components/consent-sync.
  decidedAt: string;
}

// The stored decision in full, for the code that has to reconcile it with the
// server. Distinct from readConsent, which answers the narrower question the
// banner asks ("do I show?") and deliberately flattens everything unusable to
// `unset`.
export interface ConsentRecord {
  analytics: ConsentDecision;
  version: string;
  source: ConsentSource;
  decidedAt: string;
}


// The exact bytes readConsent expects, for anyone who has to write the value
// without going through writeConsent - i.e. the e2e seed, which runs in the
// Playwright process where there is no `window` to write to.
//
// Sharing this rather than letting the harness hand-roll the JSON is what stops
// the two drifting: a seed that writes a shape readConsent rejects does not
// fail loudly, it just quietly counts as "never asked".
export function serializeConsent(
  decision: ConsentDecision,
  source: ConsentSource = 'banner',
  version: string = POLICY_VERSION,
  decidedAt: string = new Date().toISOString()
): string {
  const stored: StoredConsent = { analytics: decision, version, source, decidedAt };
  return JSON.stringify(stored);
}

// The stored decision, or null if there isn't a usable one.
//
// Same acceptance rules as readConsent - including that a decision recorded
// against an older POLICY_VERSION does not count - so the two can never
// disagree about whether a decision exists. An unrecognised `source` is
// tolerated rather than rejected: it is provenance, and losing a real decision
// because a future version added a fourth source would be the worse failure.
export function readConsentRecord(): ConsentRecord | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as Partial<StoredConsent>;
    if (stored.version !== POLICY_VERSION) return null;
    if (stored.analytics !== 'granted' && stored.analytics !== 'denied') return null;

    const source: ConsentSource =
      stored.source === 'banner' || stored.source === 'settings' || stored.source === 'login-sync'
        ? stored.source
        : 'banner';

    // A record written before this field existed, or carrying a mangled value,
    // is treated as maximally old rather than discarded: the decision is the
    // part that matters, and the worst outcome of an epoch timestamp is that
    // the server's copy wins, which is the safe direction.
    const decidedAt =
      typeof stored.decidedAt === 'string' && !Number.isNaN(Date.parse(stored.decidedAt))
        ? stored.decidedAt
        : new Date(0).toISOString();

    return { analytics: stored.analytics, version: stored.version, source, decidedAt };
  } catch {
    return null;
  }
}

// Reads the stored decision, or `unset` if there isn't a usable one.
//
// The narrow question the banner asks - "do I show?" - expressed in terms of
// readConsentRecord below rather than parsing the value a second time. The two
// used to have their own copies of the accept/reject rules, which is precisely
// the pair that must never drift: if they disagreed about whether a decision
// exists, the banner would go away while the sync still pushed, or the reverse.
export function readConsent(): ConsentState {
  return readConsentRecord()?.analytics ?? 'unset';
}

// Records a decision against the current policy version.
//
// Never writes `unset`: there is no way back to "never asked" from the UI, and
// offering one would only produce a state the banner cannot distinguish from a
// first visit. Withdrawing consent is `denied`, which is a decision.
export function writeConsent(
  decision: ConsentDecision,
  source: ConsentSource = 'banner',
  decidedAt: string = new Date().toISOString()
): void {
  try {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      serializeConsent(decision, source, POLICY_VERSION, decidedAt)
    );
  } catch {
    // Storage blocked, so the decision cannot be persisted at all and the next
    // visit will ask again.
    //
    // **Swallowing it here means readConsent will keep answering `unset`**, and
    // `unset` is the state that shows the banner - so on its own this would
    // leave the banner undismissable for the very user who blocked storage.
    // components/consent-banner is where that is actually handled, by
    // remembering the choice in component state for this page's lifetime; see
    // `decidedHere` there. This comment used to claim the caller did that
    // without any caller doing it, which is the kind of comment that stops a
    // reader checking.
  }
}
