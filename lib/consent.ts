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
