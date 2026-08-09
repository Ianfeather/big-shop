# Audit `Cache-Control` across the Go API

Implements [`follow-ups.md`](../follow-ups.md) #44. That item is the audit's *findings*;
this is the plan for acting on them. Read #44 first — it records why the original framing
("put cacheable pages and endpoints behind a CDN so we can globally distribute") dissolved
into a headers problem rather than an infrastructure one, and it is not repeated here.

## The problem

The Go API sets no cache headers at all, on any of its routes.

**There are 25 of them, not the 22 #44 counted.** Three account-scoped operations have been
added since the audit was written, so the split is 22 account-scoped and 3 unscoped, not
19 and 3. It does not change any of #44's conclusions — the three unscoped routes are the
same three — but the numbers in #44 are stale and are corrected here rather than repeated.

Since [ADR-0006](../docs/adr/0006-go-api-leaves-netlify-functions.md) browser API traffic
crosses Netlify's edge, via the `/api/bigshop/*` `status = 200` rewrite in `netlify.toml`.
Netlify does **not** cache proxied responses by default and will not cache one without a
cache-control header, so the missing headers cost two different things:

- **Every catalog read travels to Frankfurt**, on a response that is identical for every
  caller and changes rarely or never.
- **Nothing on the account-scoped routes says "do not store this."** The absence of a
  header is not the same as `no-store`; it leaves the decision to whatever intermediary is
  in the path. This is the half that is a risk rather than a missed optimisation.

## What ships

### 1. A safe default: `private, no-store` on everything

A negroni middleware in `GetRouter` sets `Cache-Control: private, no-store` on every
response before dispatch, placed **first in the stack** — ahead of the `/health` carve-out
and the JWT middleware — so that 401s and error responses carry it too, not only handler
successes.

First rather than just below the carve-out, which is where this was originally drafted:
`/health` is answered by the carve-out without ever reaching a handler, so there is nothing
downstream that could give it a policy, and an uptime monitor's health response is not
something any intermediary should be storing either. It is outside the 25 routes the audit
covered, so this is a small deliberate widening of scope rather than an oversight.

**The default is the mechanism, not a convenience.** Twenty-two of the 25 routes are
account-scoped and mutable and want exactly this; a route added tomorrow gets it without
anyone remembering to. `public` reaching an account-scoped route would serve one Account's
Shopping List to another, and this is what makes that require a deliberate act.

The middleware writes into `w.Header()` before the handler runs, so a handler setting the
same header replaces it — which is how the three overrides below work.

### 2. The three unscoped routes, each answered differently

Colocated with the route, as a Huma output header field, so the policy sits next to the
thing it governs and lands in the generated OpenAPI spec.

| Route | Header | Reasoning |
|---|---|---|
| `GET /tags` | `public, max-age=0, s-maxage=86400` | The `tag` table is a fixed list seeded by migration that no code path writes to — see `hooks/use-tags.ts`, which documents why nothing invalidates it. Long, and no purge needed. |
| `GET /units` | `public, max-age=0, s-maxage=300`, plus `Netlify-Cache-Tag: units` | An Open catalog: saving a Recipe upserts every Unit its ingredients reference (`service/recipe.go`'s `insertUnits`), so an import can coin `"bunch"`. Purged on write (below), with the 5-minute `s-maxage` as the backstop. |
| `GET /ingredients` | `no-store` | Read server-side by `lib/recipe-import/known-names.ts` through `API_HOST_INTERNAL`, straight to Fly — it never touches the edge, so edge caching buys it nothing. An in-process cache in that module is the real win and is separate work. |

`max-age=0` on the two cached routes: Huma emits no `ETag`, and TanStack Query already
holds these client-side, so there is nothing to gain from a browser TTL and a stale browser
copy would be invisible to the purge.

**Accepted consequence: the two cached routes become publicly readable.** `Authorization`
is not part of Netlify's default cache key and `Netlify-Vary` cannot be made to vary on it,
so a `public` response cached from an authenticated request is served to whoever asks next.
Acceptable because the catalog is global and non-personal by design
([ADR-0001](../docs/adr/0001-global-ingredient-catalog.md)) — and unacceptable anywhere
else, which is what item 1 enforces.

### 3. Purging `units` on write

A new `internal/pkg/purge` package calling Netlify's purge API
(`POST https://api.netlify.com/api/v1/purge`, `Authorization: Bearer <PAT>`, body
`{"site_id": …, "cache_tags": […]}`), invoked from the add-recipe and edit-recipe handlers.
A delete cannot coin a Unit, so it is not wired there.

Three properties, each of which is a requirement rather than a nicety:

- **Best-effort and asynchronous. A purge must never fail a Recipe save.** The call happens
  on a goroutine; a failure is logged and goes no further.
- **Coalescing, because the rate limit is low.** Netlify allows a tag to be purged twice
  every five seconds before returning 429 — a burst of saves, the e2e suite, or a re-run of
  `scripts/backfill-recipe-method.mjs` all exceed that. At most one purge fires per 5s
  window per tag; anything arriving inside the window collapses into a single trailing
  purge at its end.
- **A no-op when unconfigured.** With `NETLIFY_PURGE_TOKEN` or `NETLIFY_SITE_ID` unset the
  purger does nothing, which is what local development, e2e and CI get. The `s-maxage`
  backstop is what makes a dropped, rate-limited or unconfigured purge self-heal, and is
  why it is measured in minutes rather than a year.

This costs a Netlify personal access token as a Fly secret — a re-coupling to Netlify's
control plane immediately after a migration that reduced it. Accepted knowingly, and
recorded as an ADR.

## Out of scope

- The in-process cache for `lib/recipe-import/known-names.ts` — #44 names it as the real
  win for `/ingredients` and as separate work. Opened as a new follow-up.
- Setting the two secrets on Fly. That is a deploy step; the purger degrades to a no-op
  until they exist, so nothing here is blocked on it.
