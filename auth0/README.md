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
3. Deploy — **before** shipping an API build that expects the claim. See the
   hard-dependency note below; the API does not tolerate its absence.

### Ordering is load-bearing

This Action must sit **above** `link-social-identities` in the trigger. That one
can call `api.authentication.setPrimaryUser`, after which Auth0 halts the login
flow and **executes no further Actions**. Reverse the order and the single login
that gets linked is the single login whose token carries no email claim.

### The Action is a hard dependency, not an enhancement

**Deploy this Action before the API build that expects it.** It is unconditional,
so every token minted while it sits in the post-login trigger carries the claim —
and every token minted without it carries nothing, which the API answers with
`403` on `POST /user` and all three invitation routes. That is most of the app.

An earlier draft softened this: `POST /user` fell back to the address in the
request body, and `GET /invites` returned an empty list rather than refusing, so
a token minted before the Action kept working. Both were dropped deliberately.
The fallback put the welcome email, the onboarding sequence, the deletion
confirmation and the SendGrid recipient erasure back under the caller's control
for exactly as long as such a token survived — an unobservable window an
attacker can simply wait for — and the empty list disguised the reason for a
failure the caller could have fixed by signing in again. One condition, one
answer, in all four places.

Auth0 runs the post-login trigger on **refresh-token exchange** as well as on a
real login, so a session already in flight would acquire the claim on its next
renewal anyway. That is a nice property rather than a plan: the deploy order is
what makes this safe.

`auth.failure_reason = no_verified_email` is recorded on the span every time a
route refuses for this reason. A trace carrying it means the Action is not
running — the fix is in the dashboard, and nothing else in the trace would say
so.

### Testing it

`DISABLE_AUTH=true` locally supplies a synthetic verified address
(`DEV_USER_EMAIL`, defaulting to the one `docker/mysql-seed/dev-seed.sql` gives
`local-dev-user`), so the dev stack and the e2e suite exercise the *verified*
path rather than silently taking the empty branch. The claim itself can only be
tested against a real tenant:

1. Sign in to a deploy preview and decode the access token (jwt.io, or the
   Network tab) — both claims should be present, and `email_verified` should be
   a JSON `true`, not `"true"`. If they are absent, everything below fails with
   `403` and the span says `no_verified_email`.
2. Check **Monitoring → Logs** for the Action running on a *refresh*, not just
   on the initial login. That is the property the no-forced-re-login rollout
   rests on.
3. The regression the claim closes is covered by
   `TestInviteRoutesRefuseATokenCarryingNoVerifiedEmail`, which drives the
   handlers with a nil database so that a guard removed or moved below the
   lookup panics rather than failing quietly.
