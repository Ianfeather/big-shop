# Auth0 configuration that lives outside the tenant

The Auth0 tenant is configured through its dashboard, not from this repository —
there is no Terraform provider or `a0deploy` pipeline here. What that leaves is
code with no home: an Action is a JavaScript file that exists only inside a
dashboard text box, invisible to review, to `git log`, and to anyone reading
this codebase trying to work out why logins behave the way they do.

So the source of truth for **behaviour** is this directory, and the source of
truth for **what is running** is the dashboard. Those can drift, and the only
thing preventing it is the discipline of editing here first and pasting second.
Say so in the PR when you change one.

## `actions/add-verified-email-claim.js`

Puts the identity provider's own email address on the access token, as
`https://bigshop.life/email` and `https://bigshop.life/email_verified`.

**This is a security fix, not a convenience.** Before it, the API lifted only
`sub` out of the validated token and took the caller's email address from the
`POST /user` request body — which the caller controls, and which the upsert
refreshes on every login. `invite.email` was matched against that value, and
`GET /invites` returns the invite *token*, so any authenticated person could
name somebody else's address, read the invitation sent to it, and accept their
way into that Account. The reasoning is in the file header and in
`internal/pkg/app/claims.go`.

### Setup

1. **Actions → Library → Create Action → Build from scratch**, trigger
   **Login / Post Login**. Paste the file's contents over the default body. No
   secrets, no dependencies, no Management API access — it only reads `event`.
2. **Actions → Triggers → post-login**, drag it in, and **put it first**. See
   the ordering note below.
3. Deploy. Nothing else needs doing: the API tolerates its absence and starts
   trusting the claim the moment it appears.

### Ordering is load-bearing

This Action must sit **above** `link-social-identities` in the trigger. That one
can call `api.authentication.setPrimaryUser`, after which Auth0 halts the login
flow and **executes no further Actions**. Reverse the order and the single login
that gets linked is the single login whose token carries no email claim.

### Rolling it out needs no forced re-login

Auth0 runs the post-login trigger on **refresh-token exchange** as well as on a
real login, so sessions already in flight acquire the claim the next time the
SPA renews its token — invisibly, with no sign-out. Until then those tokens
simply have no claim, which the API handles deliberately rather than
accidentally:

| Route | With no claim | Why |
| --- | --- | --- |
| `POST /user` | falls back to the body address | so a signup mid-rollout cannot fail; nothing downstream decides access on it any more |
| `GET /invites` | returns an empty list | it is the account page's first load, and a token minutes older than the Action should not render an error |
| `POST /invite/accept`, `/reject` | `403` | **no fallback** — a fallback would leave the hole open for exactly as long as pre-Action tokens circulate, which is the window an attacker would aim at |

`errNoVerifiedEmail` is recorded on the span each time a caller reaches an
invitation route without the claim, so the rollout is observable: a trickle that
falls away is old tokens ageing out, and a flat line that never falls is the
Action not running.

### Testing it

`DISABLE_AUTH=true` locally supplies a synthetic verified address
(`DEV_USER_EMAIL`, defaulting to the one `docker/mysql-seed/dev-seed.sql` gives
`local-dev-user`), so the dev stack and the e2e suite exercise the *verified*
path rather than silently taking the empty branch. The claim itself can only be
tested against a real tenant:

1. Sign in to a deploy preview and decode the access token (jwt.io, or the
   Network tab) — both claims should be present, and `email_verified` should be
   a JSON `true`, not `"true"`.
2. Check **Monitoring → Logs** for the Action running on a *refresh*, not just
   on the initial login. That is the property the no-forced-re-login rollout
   rests on.
3. The regression the claim closes is covered by
   `TestInviteRoutesRefuseATokenCarryingNoVerifiedEmail`, which drives the
   handlers with a nil database so that a guard removed or moved below the
   lookup panics rather than failing quietly.
