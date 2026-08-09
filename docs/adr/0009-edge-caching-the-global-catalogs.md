# Edge-caching the global catalogs, and re-coupling to Netlify to purge them

Status: accepted

`GET /tags` and `GET /units` are served `public` with an `s-maxage`, so Netlify's CDN
answers them from the edge rather than crossing to Frankfurt. `/units` additionally carries
a `Netlify-Cache-Tag`, and a Recipe create or edit purges that tag through Netlify's purge
API. Every other route — the twenty-two account-scoped ones, plus `/ingredients` — is
explicitly `no-store`.

The alternative to all of this is the status quo: no cache headers anywhere. That is not a
neutral default, which is the reason this is written down.

## Why cache them at all

They are the only three routes with no account scoping: the same bytes for every caller.
`tag` is a fixed list seeded by migration that no code path writes to. `unit` is an Open
catalog, but one that changes only when a Recipe save coins a name. Both are read on the
critical path of rendering the Recipe form, and since
[ADR-0006](./0006-go-api-leaves-netlify-functions.md) browser traffic already crosses
Netlify's edge via the `/api/bigshop/*` rewrite — so there is no CDN to add, only headers
that are missing.

**The half that matters more is the other one.** No header is not the same as `no-store`;
it leaves the decision to whatever intermediary is in the path. The default this introduces
— `private, no-store` on everything, overridden only by deliberate act — is the point of
the change, and the two cached routes are the payoff.

## Accepted: the cached routes become publicly readable

`Authorization` is not part of Netlify's default cache key, and `Netlify-Vary` cannot be
made to vary on it. So a `public` response cached from an authenticated request is served
to whoever asks next, authenticated or not.

Accepted because these two catalogs are global and non-personal by design
([ADR-0001](./0001-global-ingredient-catalog.md)): a list of tag names and unit names
belonging to no Account. It reveals that Big Shop knows about "bunch".

**This must never extend to an account-scoped route** — one Account's Shopping List would
be served to another. That is why the safe default sits in middleware and the exceptions
are three named routes with a test asserting the set has not grown.

## Accepted: a Netlify token as a Fly secret

Purging costs `NETLIFY_PURGE_TOKEN` (a personal access token) and `NETLIFY_SITE_ID` as
secrets on Fly — a re-coupling to Netlify's control plane immediately after ADR-0006
reduced exactly that coupling. Accepted knowingly, and bounded:

- **The API does not depend on it.** Unset, the purger is a no-op, which is what local
  development, e2e and CI run as. Nothing fails; `/units` is simply five minutes stale at
  worst.
- **The purge is best-effort and asynchronous.** It happens on a goroutine after the write
  has succeeded and swallows its own errors. **A purge must never fail a Recipe save** — a
  cache optimisation cannot be allowed to cost a user their recipe.
- **The `s-maxage` is the real guarantee.** Five minutes on `/units`, deliberately short
  enough that a dropped, rate-limited or unconfigured purge self-heals without anyone
  noticing. The purge makes the common case fast; the TTL is what makes it correct.

The alternative — no purge, and a TTL short enough to make an Open catalog acceptable
without one — means something like thirty seconds, which caches almost nothing. The
alternative in the other direction, a long TTL with no purge, means a user who imports a
recipe coining "bunch" cannot see it in the unit list for an hour.

## Rate limiting is a design constraint, not an edge case

Netlify allows a tag to be purged twice every five seconds and returns 429 beyond that. A
user saving several recipes in a row, the e2e suite, or a re-run of
`scripts/backfill-recipe-method.mjs` all exceed that comfortably.

So purges **coalesce**: one call goes immediately, and anything arriving inside the window
collapses into a single trailing call at its end. A hundred saves inside one five-second
window cost two requests rather than a hundred; sustained load settles at one request every
five seconds, not two. This is why the purger holds state rather than being a bare HTTP
call.

**The implementation spends one of the two allowed purges per window, not both**, which is
deliberate rather than an off-by-one. Two purges of the same tag in one window achieve
nothing the first did not — the second invalidates an entry the first already dropped —
while sitting exactly on a documented limit means any clock skew or retry turns into a 429,
and a 429 is a purge that silently did not happen. Half the allowance buys the same
freshness with room to be wrong in.

## What was rejected

**Caching `/ingredients` too.** It looks identical to the other two — no account scoping,
same bytes for everyone — and gets `no-store` anyway. Its only consumer is
`lib/recipe-import/known-names.ts`, which runs server-side in a Netlify function and calls
Fly directly via `API_HOST_INTERNAL`. That request never crosses the edge, so an `s-maxage`
would be a header nothing acts on, bought at the price of `public`.

**This rejection is conditional on that call path, and the call path is worth revisiting.**
Those Netlify functions default to `cmh` (US East, Ohio) per ADR-0006, so every import
fetches the whole unbounded Ingredient catalog from Frankfurt and back — the transatlantic
cost ADR-0006 existed to remove, reintroduced from the other side. Pointing that one call
at `www.bigshop.life` rather than the Fly origin would put it back on the edge and make it
cacheable exactly like `/units`, served from a PoP beside the caller. Not done here because
it is a change to how the import path reaches the API rather than a header, and it deserves
measuring first. Tracked as follow-up #51, which frames that choice against an in-process
cache and against moving extraction into the Go API altogether.

**`Netlify-CDN-Cache-Control` instead of `Cache-Control`.** More precise — it is
Netlify-specific and invisible to the browser — but it would mean the policy is legible
only to one vendor. `Cache-Control` with `max-age=0, s-maxage=N` says the same thing to any
shared cache, and `max-age=0` is honest: Huma emits no `ETag` and TanStack Query already
caches these client-side, so a browser TTL would buy nothing and a stale browser copy is
one no purge could ever reach.
