/**
 * post-login — link a returning person's second sign-in method to the Auth0
 * account they already have, so Big Shop keeps seeing one subject for them.
 *
 * ## Why this exists
 *
 * `user.id` and `account_user.user_id` in Big Shop's database hold the raw
 * Auth0 subject, there is no foreign key to Auth0, and nothing detects a
 * mismatch. A subject nobody has seen before is therefore indistinguishable
 * from a new person: the API creates a User row and hands them a brand-new,
 * empty Account. So without this Action, an existing Google user tapping
 * "Sign in with Microsoft" loses every recipe they own — same human, same
 * address, new empty account, no error raised anywhere.
 *
 * Linking makes both providers resolve to one subject, which is the only
 * mitigation that actually prevents the problem rather than reporting it.
 *
 * ## This is the belt; the API has the braces
 *
 * `POST /user` refuses with a 409 when it sees an email already held under a
 * different subject, and the app shows a "Your recipes are safe" screen. That
 * guard is deliberately still there, and this Action is written to **fail into
 * it** rather than around it: every check below returns without linking rather
 * than guessing, and a Management API failure is swallowed. The worst outcome
 * of this Action doing nothing is the 409 screen. The worst outcome of it
 * linking something it should not have is somebody reaching a stranger's
 * recipes, so the asymmetry decides every judgement call in here.
 *
 * **It must never deny the login.** `api.access.deny` on a Management API blip
 * would lock the whole userbase out of an app whose accounts are all fine.
 *
 * ## Setup
 *
 * See ../README.md for the secrets, the M2M application's scopes, and how to
 * test it against a real second provider.
 */

// The connections this Action will link, on either side. **An allowlist, and
// it is load-bearing rather than tidy.**
//
// Every entry has to be a connection where the identity provider verifies the
// address itself. That is what makes `email_verified` mean something: on a
// database (username/password) connection the address is self-asserted until a
// confirmation mail is clicked, so linking on it would be an account-takeover
// primitive — sign up claiming somebody's address, get linked to their account,
// read their recipes.
//
// Big Shop's database connection is currently disabled, which is what makes
// auto-linking defensible at all here. Re-enabling it is an open question on
// the board, and **if it comes back, it must not be added to this list** without
// deciding that question deliberately.
const TRUSTED_CONNECTIONS = ['google-oauth2', 'windowslive', 'apple'];

/**
 * A Management API token, cached for as long as the Action's container lives.
 *
 * Module scope survives between executions on a warm container and is empty on
 * a cold one, which is exactly the behaviour wanted: it saves a token request
 * on most logins and is merely a miss, never a bug, when it does not. Nothing
 * here depends on the cache existing.
 */
let cachedToken = null;

exports.onExecutePostLogin = async (event, api) => {
  let primaryUserId;

  try {
    primaryUserId = await findAndLink(event);
  } catch (error) {
    // Swallowed on purpose — see the header. A failure here means the person
    // signs in under the new subject and meets the API's 409 screen, which is
    // recoverable; denying the login is not.
    console.log(`account linking failed, falling through to the app's guard: ${error.message}`);
    return;
  }

  if (!primaryUserId) return;

  // **The half that is easy to miss.** Linking rewrites Auth0's records but
  // does not retarget the login already in flight, so without this the very
  // session that triggered the link still carries the *secondary* subject —
  // and Big Shop reads the subject off the token. The person would be linked
  // correctly and still land in an empty account for this one login.
  api.authentication.setPrimaryUser(primaryUserId);
};

/**
 * Decides whether this login should be linked, and does it.
 *
 * Returns the primary user's id when a link was made, or undefined when any
 * check said no. Every early return is a case where linking might be right but
 * is not certainly right, and "not certainly right" resolves to leaving it to
 * the app's 409.
 */
async function findAndLink(event) {
  const email = event.user.email;

  // Nothing to match on. Apple with Private Relay lands here too when the
  // relay address does not match anything — see README.md, it is a known and
  // unavoidable hole, not an oversight.
  if (!email || !event.user.email_verified) return;

  if (!TRUSTED_CONNECTIONS.includes(event.connection.name)) return;

  // **Only ever on an identity's first login**, and this is the check that
  // makes the Action safe against the one thing linking cannot undo.
  //
  // Auth0 linking merges *logins*. It does not merge Big Shop Accounts: the
  // database still holds a `user` row and an `account` row for the secondary
  // subject, and after linking nothing can ever resolve to them again. So
  // linking an identity that has been used before can strand whatever was
  // saved under it — the exact harm this whole exercise is about, caused by the
  // fix for it.
  //
  // An identity on its first login cannot have accumulated anything, because
  // Big Shop only ever writes rows for a subject that has logged in. Anyone who
  // has already double-signed-up gets no link and meets the 409 screen, which
  // is the correct outcome: merging two populated accounts is a data decision
  // for a human, not something to infer during a login.
  //
  // `<= 1` rather than `=== 1` because Auth0's documentation does not commit to
  // whether the count includes the login in progress, and both readings mean
  // the same thing here.
  if (event.stats.logins_count > 1) return;

  const token = await managementToken(event);
  const sharing = await usersWithEmail(event, token, email);

  const others = sharing.filter((candidate) => candidate.user_id !== event.user.user_id);

  // Nobody else holds the address: an ordinary new signup, which is most of
  // what reaches this line. Nothing to link.
  if (others.length === 0) return;

  // More than one. Somebody has already double-signed-up, so choosing a primary
  // means choosing whose recipes survive — see the note above. Refuse.
  if (others.length > 1) {
    console.log(`account linking declined: ${others.length} existing users share this address`);
    return;
  }

  const primary = others[0];

  // The existing account has to clear the same bar as the arriving one, on both
  // counts. An unverified address on the *primary* side is the takeover vector
  // read backwards: it would let a verified new login be attached to an account
  // somebody claimed without proving they owned the address.
  if (!primary.email_verified) return;
  if (!(primary.identities || []).every((identity) => TRUSTED_CONNECTIONS.includes(identity.connection))) return;

  // **The pre-existing account is always primary, and this is not a
  // preference.** Big Shop's `user.id` and `account_user.user_id` rows already
  // point at its subject. Making the arriving identity primary would leave
  // every one of those rows pointing at a subject that no longer resolves —
  // the same person, locked out of their own data, with no error to explain it.
  //
  // `logins_count <= 1` above already establishes which is which: the arriving
  // identity is the new one by construction.
  const secondary = event.user.identities[0];

  await linkIdentity(event, token, primary.user_id, {
    provider: secondary.provider,
    // The bare provider-side id, not the full `provider|id` subject. This is
    // why it is read off the identity rather than split out of `user_id`.
    user_id: secondary.user_id,
  });

  console.log(`account linking: attached ${secondary.provider} to an existing account`);
  return primary.user_id;
}

/**
 * A client-credentials token for the Management API.
 *
 * **Called over plain fetch rather than through the `auth0` npm package**, and
 * that is deliberate. An Action's dependencies are pinned in the dashboard
 * rather than in this file, the package's client surface has been reshaped
 * across recent majors (`usersByEmail.getByEmail` and `users.link` in one
 * version, `users.listUsersByEmail` and `users.identities.link` in another),
 * and there is nothing in this repository that would fail when the pinned
 * version and this code disagree — the first symptom would be a login-time
 * TypeError in production. Two endpoints do not justify that exposure, and
 * `fetch` is global on every Node runtime Actions offer.
 */
async function managementToken(event) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const domain = event.secrets.AUTH0_DOMAIN;
  const audience = `https://${domain}/api/v2/`;

  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: event.secrets.MGMT_CLIENT_ID,
      client_secret: event.secrets.MGMT_CLIENT_SECRET,
      audience,
    }),
  });

  if (!response.ok) {
    throw new Error(`management token request returned ${response.status}`);
  }

  const body = await response.json();
  cachedToken = {
    value: body.access_token,
    // A minute of headroom, so a token cannot expire between this check and the
    // request that uses it.
    expiresAt: now + (body.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

/**
 * Every Auth0 user holding this email address.
 *
 * Lowercased before searching: Auth0 stores addresses in lower case and this
 * endpoint matches exactly, so `Ada@Example.com` would find nothing and the
 * silent result would be no link — which reads as the feature not working
 * rather than as a bug.
 */
async function usersWithEmail(event, token, email) {
  const url = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users-by-email`
    + `?email=${encodeURIComponent(email.toLowerCase())}`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`users-by-email returned ${response.status}`);
  }
  return response.json();
}

/**
 * Attaches a secondary identity to a primary user.
 *
 * The user named in the *path* becomes primary; the body names what is being
 * folded into them. Reversing the two is the failure mode called out above, and
 * it is not detectable afterwards from the response.
 */
async function linkIdentity(event, token, primaryUserId, secondary) {
  const url = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users/`
    + `${encodeURIComponent(primaryUserId)}/identities`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(secondary),
  });

  if (!response.ok) {
    throw new Error(`identity link returned ${response.status}`);
  }
}
