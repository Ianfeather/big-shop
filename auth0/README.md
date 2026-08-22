# Auth0 configuration that lives outside the tenant

The Auth0 tenant is configured through its dashboard, not from this repository —
there is no Terraform provider or `a0deploy` pipeline here, and adding one for a
single Action would cost more than it returns. What that leaves is code with no
home: an Action is a JavaScript file that exists only inside a dashboard text
box, invisible to review, to `git log`, and to anyone reading this codebase
trying to understand why logins behave the way they do.

So the source of truth for **behaviour** is this directory, and the source of
truth for **what is running** is the dashboard. Those can drift, and the only
thing preventing it is the discipline of editing here first and pasting second.
Say so in the PR when you change one.

## `actions/link-social-identities.js`

A post-login Action that links a returning person's second sign-in method to
the account they already have.

**Why it is needed** is argued at the top of the file and on the board item
[Offer more social login options than Google][board]. The short version: Big
Shop stores the raw Auth0 subject with no foreign key back to Auth0, so an
unrecognised subject silently becomes a new, empty Account. Adding Microsoft or
Apple without this means an existing Google user can sign in the "wrong" way and
find every recipe gone.

### What it does not do

- **It never denies a login.** Any failure falls through to Big Shop's own
  guard, which answers `409` from `POST /user` and shows the "Your recipes are
  safe" screen. That guard stays regardless of this Action; the two are layered
  deliberately, and the Action is written to fail *into* it.
- **It does not merge Big Shop Accounts.** Auth0 linking merges logins. If two
  populated Accounts already exist, linking would make one of them permanently
  unreachable — so the Action refuses that case rather than choosing whose
  recipes survive. It only ever links an identity on its **first** login.
- **It does not help Apple Private Relay users.** Apple can hand over
  `…@privaterelay.appleid.com` instead of the real address, which will never
  match an existing Google account, so those users get a fresh Account and meet
  the 409 screen. This is a hole in the mitigation with no fix at this layer —
  it is the strongest argument for prompting during Apple signup rather than
  relying on linking alone.

### Setup

**1. A machine-to-machine application with Management API access.**

Check whether the one behind `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET`
on Fly (added for account deletion) can be reused — a second M2M app is a second
credential to rotate for no benefit. It needs, under
**Applications → APIs → Auth0 Management API → Machine to Machine Applications**:

| Scope | Why |
| --- | --- |
| `read:users` | the `users-by-email` lookup |
| `update:users` | the identity link itself |

Account deletion already needs `delete:users`, so reuse means widening an
existing application rather than starting from nothing.

**2. Create the Action.** **Actions → Library → Create Action → Build from
scratch**, trigger **Login / Post Login**. Paste the contents of
`actions/link-social-identities.js` over the default body.

Do **not** install the `auth0` npm dependency. The file calls the Management API
over `fetch` on purpose — the package's client surface has been reshaped across
recent majors, the pinned version lives in the dashboard rather than in this
file, and nothing in CI would catch the two disagreeing. The first symptom of a
mismatch would be a login-time `TypeError` in production.

**3. Add three secrets** in the Action's **Secrets** panel:

| Key | Value |
| --- | --- |
| `AUTH0_DOMAIN` | the **canonical** tenant domain (`dev-x-n37k6b.eu.auth0.com`), not a custom domain — the Management API audience is always the canonical one |
| `MGMT_CLIENT_ID` | the M2M application's client id |
| `MGMT_CLIENT_SECRET` | its client secret |

**4. Deploy, then add it to the flow.** Deploying an Action does not run it.
Drag it into **Actions → Triggers → post-login** and apply, or nothing happens
and everything looks fine.

**5. Check the allowlist matches reality.** `TRUSTED_CONNECTIONS` in the file
lists the connections that may be linked, by Auth0 connection name — not
strategy, not display name. Confirm each against **Authentication → Social**
before relying on it; a typo silently disables linking for that provider, and
the symptom is the 409 screen rather than an error.

**The allowlist exists because every entry must be a connection where the
identity provider verifies the address itself.** That is what makes
`email_verified` meaningful. A database (username/password) connection asserts
whatever the user typed until they click a confirmation mail, so linking on one
would let somebody claim another person's address and inherit their recipes.
Big Shop's database connection is currently disabled, which is what makes
automatic linking defensible here at all. **Whether it comes back is an open
question on the board — if it does, it must not join this list without settling
that question first.**

### Testing it

`DISABLE_AUTH=true` locally means none of this is exercised by the dev stack,
the e2e suite, or CI. It can only be tested against a real tenant.

1. Sign in to a deploy preview with Google and save a recipe, so there is
   something to lose.
2. Sign out, then sign in with Microsoft using the same address.
3. **Expected:** the recipe is still there, and Auth0's user record shows two
   entries under **Identities** with the Google one primary.
4. **The failure worth looking for specifically** is landing in an empty account
   *while* the Auth0 record shows the identities correctly linked. That means
   the link worked and `api.authentication.setPrimaryUser` did not, so this
   login is still carrying the secondary subject.
5. Then check **Monitoring → Logs**, filtered to `Success Login`, and read the
   Action's `console.log` lines — every decline logs its reason.

Test the declines too, and the second one is the important one: a second
identity that has *already* logged in once must **not** be linked, because that
is the case where linking would strand data. Both should end on the "Your
recipes are safe" screen rather than in an empty account.

[board]: https://app.notion.com/p/3c3c724ecda18140bbcdca9521ad17a3
