# Logging in on a deploy preview

**Working, on one fixed host:
[`preview--big-shop.netlify.app`](https://preview--big-shop.netlify.app).** Push
a branch into that slot and you can log in and use the app:

```bash
git push --force origin <branch>:preview
```

It is a shared slot — one branch at a time. A *numbered* preview
(`deploy-preview-<N>--…`) still cannot be logged into, deliberately; see layer 2.

Until this was fixed you could not get past the login screen on any preview,
which removed most of the reason to have previews at all — the Fly migration's
own cutover verification had to be run against production because of it
(follow-ups.md #48). There were two layers, and the console setting was the
second one, not the first.

## Layer 1 — the app asked to be sent to the wrong place (fixed)

`NEXT_PUBLIC_HOST` is a *build-time* constant: Next.js inlines every
`NEXT_PUBLIC_*` value into the bundle, and `.env.production` pins it to
`https://www.bigshop.life`. So every production-mode build — previews included —
told Auth0 to redirect to the live site, and you "logged in" somewhere else.

Four call sites were affected, and they wanted two different fixes:

| Call site | Fix |
| --- | --- |
| `pages/_app.tsx`, `hooks/use-login.ts` (`redirect_uri`) | `appOrigin()` |
| `components/identity/logout` (`returnTo`) | `appOrigin()` |
| `pages/recipes/new.tsx`, `components/method-import`, `components/recipe-form/Form.tsx` (Next.js API routes) | relative path |

- [`lib/app-origin.ts`](../lib/app-origin.ts) returns `window.location.origin`,
  falling back to `NEXT_PUBLIC_HOST` when there is no window (SSR). Only Auth0
  needs an absolute origin, because it is handed to a third party.
- The Next.js API routes are served by the same app, so they just take a
  relative path and the browser resolves it. Prefixing them with
  `NEXT_PUBLIC_HOST` had made them *cross-origin calls into production's*
  `/api/parse-recipe-url`, `/api/parse-method-url` and `/api/recipe-image` from
  every preview — the import features appeared to work while exercising code
  that was not on the branch. See the note in
  [`lib/api-client.ts`](../lib/api-client.ts).

`NEXT_PUBLIC_HOST` is still set, and still used: as the SSR fallback above, and
as the default web origin for `scripts/backfill-recipe-method.mjs`. It is no
longer what the browser acts on.

## Layer 2 — Auth0 has to allow the origin (done, but by hand)

Asking for the right `redirect_uri` is not enough; Auth0 rejects any callback to
an origin that is not allowlisted on the application
([console](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)).
**This has been done for `preview--big-shop.netlify.app`** — recorded here
because it lives in the console, not in the repo, so nothing in a checkout will
tell you it exists (or warn you if someone removes it).

**Numbered previews cannot be allowlisted.** Netlify names them
`deploy-preview-<N>--big-shop.netlify.app`, and Auth0's wildcard rules require
`*` to be the leftmost subdomain component followed by a dot. So
`https://*--big-shop.netlify.app` is not expressible, and `https://*.netlify.app`
— which is — would grant callbacks to every site on Netlify and **must not be
used**.

So: one stable alias, allowlisted once. Enable a branch deploy on a fixed branch
named `preview` (Netlify → Site configuration → Build & deploy → Branches and
deploy contexts), which is served at a fixed host, and add it to all three
fields:

| Auth0 field | Entry | Why this field |
| --- | --- | --- |
| Allowed Callback URLs | `https://preview--big-shop.netlify.app` | where Auth0 may return you after login |
| Allowed Logout URLs | `https://preview--big-shop.netlify.app` | logout's `returnTo` |
| Allowed Web Origins | `https://preview--big-shop.netlify.app` | CORS for the token call |

Two things that will waste an afternoon if missed:

- **No trailing slash.** The app sends the bare origin (verified:
  `redirect_uri=https%3A%2F%2Fpreview--big-shop.netlify.app`), and Auth0 matches
  the callback exactly, so an entry ending in `/` fails.
- **Allowed Web Origins is not optional.** The app sets `useRefreshTokens`, so
  omitting it lets login *complete* and then fails the `/oauth/token` call on
  CORS — which reads as a different bug entirely.

## What a preview still cannot tell you

[ADR-0006](./adr/0006-go-api-leaves-netlify-functions.md) already accepts this
and it has not changed: `netlify.toml`'s `/api/bigshop/*` rewrite points at the
single production Fly machine, so a preview exercises **production's API and
production's data**. Previews are for frontend changes. A change to the Go API
is verified with the local stack (`npm run dev:full`) and the e2e suite, not
here.
