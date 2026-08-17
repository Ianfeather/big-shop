// The privacy policy's version, and the vocabulary the consent machinery is
// built on.
//
// Small on purpose: this is the one fact the policy page, the consent banner
// and the stored consent record all have to agree on, so it lives in one place
// rather than being typed into three. See specs/analytics-and-consent.md, whose
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
}

// Reads the stored decision, or `unset` if there isn't a usable one.
//
// Three things count as "no usable decision", and they deliberately collapse to
// the same answer:
//
//   - nothing stored, the first-visit case;
//   - a decision recorded against an older POLICY_VERSION, which is the
//     re-asking mechanism working;
//   - anything unparseable. A hand-edited or half-written value must fail to
//     `unset` rather than throw or, worse, be read as consent - the safe
//     direction here is to ask again, never to assume yes.
//
// Reading localStorage throws outright in a browser with site data blocked,
// which is why the whole thing sits in a try/catch - see the same guard in
// hooks/use-local-storage-flag.ts.
export function readConsent(): ConsentState {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return 'unset';

    const stored = JSON.parse(raw) as Partial<StoredConsent>;
    if (stored.version !== POLICY_VERSION) return 'unset';
    if (stored.analytics !== 'granted' && stored.analytics !== 'denied') return 'unset';

    return stored.analytics;
  } catch {
    return 'unset';
  }
}

// The exact bytes readConsent expects, for anyone who has to write the value
// without going through writeConsent - i.e. the e2e seed, which runs in the
// Playwright process where there is no `window` to write to.
//
// Sharing this rather than letting the harness hand-roll the JSON is what stops
// the two drifting: a seed that writes a shape readConsent rejects does not
// fail loudly, it just quietly counts as "never asked".
export function serializeConsent(decision: ConsentDecision, version: string = POLICY_VERSION): string {
  const stored: StoredConsent = { analytics: decision, version };
  return JSON.stringify(stored);
}

// Records a decision against the current policy version.
//
// Never writes `unset`: there is no way back to "never asked" from the UI, and
// offering one would only produce a state the banner cannot distinguish from a
// first visit. Withdrawing consent is `denied`, which is a decision.
export function writeConsent(decision: ConsentDecision): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(decision));
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
