/**
 * post-login — put the identity provider's own email address on the access
 * token, so the API can know who is calling without asking them.
 *
 * ## Why this exists
 *
 * The Go API validates the access token and lifts exactly one thing out of it:
 * `sub`. Every other fact about the caller arrived in a request body. That
 * included the email address, which `POST /user` writes to `user.email` and
 * refreshes on every login — and which `invite.email` was then matched against.
 *
 * The result was a live authorisation bug rather than a theoretical one: any
 * authenticated person could name somebody else's address, list the invitation
 * addressed to it (`GET /invites` returns the invite *token*), and accept their
 * way into that Account. The address was doing an authorisation job while being
 * entirely under the control of the person it was meant to identify.
 *
 * This claim is the fix. It is not a convenience, and it is not for display.
 *
 * ## Two properties the API depends on
 *
 * **The namespace is mandatory.** Auth0 silently drops a custom claim whose name
 * is not a URI under a namespace the tenant owns. The failure mode is therefore
 * not a rejected token but an absent claim — which the API reads as "no verified
 * address" and answers with an empty invitation list. Changing either name here
 * means changing `internal/pkg/app/claims.go` in the same commit; nothing
 * checks that they agree, because nothing can.
 *
 * **`email_verified` is sent as a real boolean.** The API decodes these claims
 * as part of token validation, so a value it cannot decode would reject the
 * token — on every request, for every user at once. It tolerates the string
 * forms defensively, but this side should not be the reason that guard is ever
 * needed. Hence the `=== true`.
 *
 * ## Ordering: this Action must run FIRST
 *
 * Put it above `link-social-identities` in **Actions → Triggers → post-login**.
 * That Action can call `api.authentication.setPrimaryUser`, and Auth0 stops the
 * login flow immediately afterwards — *no further Actions execute*. So with the
 * order reversed, the one login that gets linked is the one login whose token
 * has no email claim, and the person lands on an empty invitation list on the
 * day they linked their account.
 *
 * ## Why the rollout does not need a forced re-login
 *
 * Auth0 runs the post-login trigger on **refresh-token exchange** as well as on
 * a real login, so a session already in flight picks the claim up the next time
 * `getAccessTokenSilently` renews its token, with nothing visible to the user.
 * The API is built for the gap either way: a token without the claim keeps
 * working everywhere except the invitation routes, which deliberately refuse
 * rather than fall back.
 */

const NAMESPACE = 'https://bigshop.life';

exports.onExecutePostLogin = async (event, api) => {
  // No guard around this, on purpose. It is not conditional on the connection,
  // on the login count, or on anything else — the API's rule is "a verified
  // address or nothing", and it enforces that itself by checking the flag. A
  // condition here could only ever produce a token that is missing a claim it
  // was entitled to, and the symptom would be somebody's invitations quietly
  // not appearing.
  api.accessToken.setCustomClaim(`${NAMESPACE}/email`, event.user.email);

  // `=== true` rather than passing the value through: see the note above on why
  // this side owes the API a real boolean. It also normalises the absent case —
  // a connection that returns no verification status at all becomes `false`,
  // which is the safe answer rather than `undefined`.
  api.accessToken.setCustomClaim(
    `${NAMESPACE}/email_verified`,
    event.user.email_verified === true
  );
};
