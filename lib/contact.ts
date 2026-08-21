// The address Big Shop tells people to write to.
//
// Shared rather than repeated because it is now on two pages that a reader
// experiences as one promise: /support offers it, and /error falls back to it
// when something has already gone wrong. An address that drifted between the
// two would be a broken promise on whichever page was forgotten, and nothing
// would fail to build.
//
// Deliberately not the address on /privacy. That one (`info@ianfeather.co.uk`)
// is the data-protection contact, it is named in a published policy, and
// changing it is a policy edit with POLICY_VERSION consequences - see the note
// at the top of pages/privacy.tsx. The two happen to be different addresses
// today; consolidating them is a decision for the owner, not a refactor.
export const SUPPORT_EMAIL = 'hello@bigshop.life';
