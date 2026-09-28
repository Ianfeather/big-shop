# Recipe Search: Similar Recipes from Jev

Searching "curry" today finds only Recipes with "curry" in the name. "Prawn
Balti" is a curry and doesn't show up. This adds a second tranche to Recipe
Search, **Similar Recipes**, judged by TypeSafe's Jev model from each Recipe's
name. The tranche sits beneath the existing **Exact Matches**, which stay exactly
as they are. The terms are defined in [CONTEXT.md](../CONTEXT.md).

Scope: Recipe names only. No method, no Ingredient Lines, no new Tag, no change
to how Exact Matches are found or ordered.

## Current state

- `components/recipe-list/index.tsx:49`: search is a case-insensitive
  substring match (`name.toLowerCase().includes(…)`), not a regex. It is ANDed
  with the host page's `filterFn` and an OR'd Tag filter, and selected Recipes
  are pinned to the top.
- That one component backs five surfaces: `pages/recipes/index.tsx`,
  `pages/recipes/[id]/index.tsx`, `pages/recipes/[id]/edit.tsx`,
  `pages/list.tsx`, `components/shopping-list/Recipes/index.tsx`.
- `GET /recipes` (`api/internal/pkg/app/recipes.go`) already returns
  `{ id, name, tags }` for the caller's Account. The client has every name and id
  before anyone types.
- There are only two Tags (Vegetarian, Batch Cook). Nothing records that a
  Recipe is a curry, a soup or Italian. Similar Recipes is the first thing
  that can answer that.

## Decisions

Settled in a design session on 2026-09-28. Each carries its reason, so a later
reader can tell a choice from an accident.

| # | Decision | Why |
| --- | --- | --- |
| 1 | All five `RecipeList` surfaces, no per-surface switch. | "Show me curries" is as useful when building a Shopping List as when browsing. A switch would be a setting nobody flips. |
| 2 | **One Jev request per search**: every candidate name goes in `state`, with one Noul per candidate. | Titles are sent once and every question runs in parallel. The alternative (one request per title, as in TypeSafe's reranking cookbook) keeps each judgment independent but means N requests per search. Phase 0 checks that the two agree on real data. |
| 3 | **Noul, not Score.** | Relevance to a search is a yes/no condition. A Score's levels would have to be worded for any possible search term, and it doesn't help batching. |
| 4 | **The question asks about relevance, not category membership.** | "Is this a {term}?" works for "curry" but fails for "chicken" (Coq au Vin contains chicken but is not a chicken) and for adjectives ("italian", "spicy"). |
| 5 | **Only the leftovers are candidates**: Recipes that pass `filterFn` and the Tag filter but did *not* exact-match. | No Recipe appears in both tranches. Tags still narrow Similar Recipes. Requests stay smaller. The cost is that toggling a Tag mid-search re-queries. |
| 6 | **Debounce ~300ms, trimmed query ≥ 3 chars, latest query wins.** | Removes most of the "cur"/"curr" partial queries. |
| 7 | **No "is this a word?" pre-question.** | A separate call adds a round trip to every real search to save the cost of partial ones the debounce already removes. A fragment should score low on every title anyway. If a plausible prefix turns out to produce false positives, add a fragment check as one more Noul in *the same* request (parallel, no added latency) and drop the tranche when it fires. |
| 8 | **Purely additive UI: no loading state.** The tranche appears when Jev answers and is simply absent if it finds nothing or fails. | Rows only ever get added *below* the Exact Matches, so nothing a User is about to click moves. The Exact Match tranche is the one we promise. |
| 9 | **No cap** on how many Similar Recipes are shown. Everything above the threshold, sorted by probability. | A User with 30 chicken dishes searching "chicken" wants all 30. If there's a noisy tail, raise the threshold rather than cut at N, since a cap hides good matches just as readily as bad ones. |
| 10 | **Served by the Go API on Fly**, not by a Netlify function. | Next API routes must authenticate (`parse-method-url.ts:18`: the newest route does, deliberately), and authenticating a Netlify route means calling the Go API. Netlify Functions run in `us-east-2`, so that path is UK → Ohio → Frankfurt → Ohio → Jev → UK, two Atlantic crossings before Jev even starts (ADR-0006 measured this shape at 1,624ms against 165ms). On Fly, auth is existing middleware, the names come from TiDB in the same metro, and the Jev key is a Fly secret just like `SENDGRID_API_KEY`. |
| 11 | **The client sends ids, the server supplies names.** | The route can only ever judge the caller's own Recipes. It is not a relay for arbitrary text on our key, and there's no need for size caps on user-supplied strings. |
| 12 | **Metrics only, no search terms.** No analytics event. | Everything we want to know fits in Grafana's 14-day retention (ADR-0008). What someone types is User content. A click-through counter is deferred. |
| 13 | **TypeSafe is named as a processor** in `/privacy`. | Unlike Import and Dave, every search sends Recipe names to a third party without the User explicitly asking for something. |

## Design

### API: `POST /recipes/similar`

Registered alongside `list-recipes` in `api/internal/pkg/app/recipes.go` as a
Huma operation (`OperationID: "similar-recipes"`). It is served at
`/api/bigshop/recipes/similar` through the existing Netlify rewrite, so it's
same-origin and the bearer token works unchanged.

```jsonc
// request
{ "query": "curry", "candidateIds": [12, 40, 41, 97] }
// response — only those above the threshold, most probable first
{ "matches": [ { "id": 97, "probability": 0.93 }, { "id": 40, "probability": 0.71 } ] }
```

- **Validation:** `query` trimmed, 3–100 characters. `candidateIds` 1–1000 ids;
  over 1000 is a 422, not a silent truncation. Fewer than 3 characters or no
  candidates is a 422. The client never sends either, so if one arrives it's a
  bug worth seeing.
- **Scoping:** one query,
  `SELECT id, name FROM recipe WHERE account_id = ? AND id IN (…)`. Ids that
  don't belong to the caller's Account are dropped silently, since they're
  either stale (another member deleted the Recipe) or not the caller's to ask
  about. If nothing survives, return `{ "matches": [] }` without calling Jev.
- **Returns probabilities**, not just ids, so the client can sort. The threshold
  is applied server-side (a named constant, starting at 0.5, set in Phase 0), so
  the client doesn't need to know it.
- **Failure is an empty tranche, not an error the User sees:** a Jev timeout,
  429/529 or 5xx comes back as `{ "matches": [] }` with the cause recorded via
  `fail`/telemetry. Jev gets a **3s** context deadline. After that, the answer
  arrives too late to matter.
- **Feature off when unconfigured:** if `TYPESAFE_API_KEY` is unset, the handler
  returns `{ "matches": [] }` without calling anything. This is the state for
  local dev, CI, e2e and deploy previews, the same pattern as
  `NEXT_PUBLIC_GA_MEASUREMENT_ID`. Log it once at startup, not per request.
- **No Go SDK.** The TypeSafe HTTP API is a single JSON `POST
  https://api.typesafe.ai/v1/systemone` with a Bearer token. Write a small
  client in `internal/pkg/service/` (for example `similar.go`) with its base URL
  injectable, so tests can point it at `httptest`. Read the
  [live API page](https://docs.typesafe.ai/api.md) when writing it, not this
  summary.

### The Jev request

```jsonc
{
  "model": "jev-latest",
  "state": { "query": "curry", "recipes": ["Prawn Balti", "Lasagne", "Chicken Katsu"] },
  "questions": {
    "r0": {
      "type": "noul",
      "instructions": "A cook searched their own recipe collection for `query`. Is `recipes[0]` a recipe they would want that search to find?",
      "criteria": {
        "true":  "The dish is an instance of what was searched for: a kind of that dish, a cuisine or style it belongs to, or a dish plainly built around that ingredient.",
        "false": "The dish only shares a word, a loose association, or a minor ingredient with the search, or is unrelated."
      }
    }
    // r1 … rN, one per candidate, identical but for the index
  }
}
```

Question ids are for our code and aren't sent to the model, so the full meaning
lives in `instructions`. The index maps back to the id through the slice built
from the SQL result. The wording above is a starting point for Phase 0 to tune,
not a final version.

### Frontend

- `RecipeList` computes `exactMatches` as today, then
  `candidates = visible (filterFn ∧ tags) − exactMatches`.
- A `useSimilarRecipes(query, candidateIds)` hook (TanStack Query, beside
  `hooks/use-recipes.ts`, keys in `lib/query-keys.ts`) debounces 300ms and is
  `enabled` only for trimmed queries of 3+ characters with at least one
  candidate. The key is `[…, query, sortedCandidateIds]`: a new key supersedes
  the old one, and TanStack's `signal` aborts the stale request. Invalidate the
  prefix wherever the recipe list is invalidated, so a rename can't serve a
  stale judgment. Errors are swallowed to "no tranche". The server already made
  them no-ops, and this covers the network failing too.
- **Rendering:** Exact Matches, then, only when there's at least one Similar
  Recipe, a horizontal rule captioned **"Similar recipes"**, then the matches in
  the server's order. With zero Exact Matches, show the caption without the
  rule. No spinner, no placeholder row.
- **Selection pinning applies within each tranche.** A selected Recipe that only
  matched semantically is pinned to the top of the Similar tranche, never
  promoted above the line.
- `ListItem` rendering, click and checkbox behaviour are unchanged in both
  tranches.

### Privacy

Add TypeSafe to `processors` in `pages/privacy.tsx`, following the existing
entries' pattern. Say what is sent and why: *the names of your recipes, and what
you typed into search, to find recipes related to your search*. **Make no claims
about retention or training.** TypeSafe's terms haven't been checked, and the
entry must be accurate without them.

### Telemetry

In the Go API, through the existing OTel meter:

- a Jev latency histogram (the design rests on "fast", so measure it)
- an outcome counter labelled `results` / `empty` / `error` / `disabled`
- candidates sent and matches returned, as histograms
- Jev input and output tokens, labelled `jev-latest` (the Go twin of
  `recordTokenUsage`)

No query text, no Recipe names, no ids. The log line may carry counts, as
`getRecipes` does.

### Configuration

`TYPESAFE_API_KEY` as a Fly secret. **Adding a secret here takes two steps**
(`api/fly.toml`'s header explains why): `fly secrets set` *and* declare it in the
`api` container's `secrets` array in `api/machine_config.json`, or it's
absent at runtime and the feature is silently off.
`scripts/check-fly-secrets.sh` fails the deploy on drift. Add the name to the
environment variable table in `technical-architecture.md`. It isn't needed in
`docker-compose.yml`; anyone wanting it locally can set it in their shell.

## Phase 0: check the design on real data before building

Against a copy of production's Recipe names (`scripts/sync-from-prod.sh` into a
local DB, or the read-only reporting account), with a throwaway script:

1. **Batched vs independent (decision 2).** For "curry", "chicken", "pasta",
   "soup", "italian", "vegetarian", "quick" and one fragment ("curr"), run the
   one-request shape and the one-request-per-title shape. If the ranked lists
   above 0.5 broadly agree, keep one request. If batching visibly distorts
   (for example, a list full of curries inflating an ambiguous title), switch to
   per-title requests and reconsider rate limits before going further.
2. **Criteria and threshold.** Tune the wording and set the constant. Record
   the chosen threshold and a handful of example judgments in the PR.
3. **Latency from Frankfurt.** `api.typesafe.ai` is behind Cloudflare and its
   origin region is unknown. Time the real request from a Fly `fra` machine
   (`fly ssh console` + `curl`), not from a laptop, and record p50/p95 for a
   ~100-title request.
4. **The fragment question (decision 7).** Check whether "curr" and similar
   produce false positives. Add the in-request fragment Noul only if they do.

## Testing

- **Go:** handler tests with `httptest` standing in for Jev. Cover: scoping
  drops foreign ids and never sends their names; threshold and sort order;
  Jev 429/5xx/timeout → `[]`; key unset → `[]` with no outbound call; empty
  candidates after scoping → no outbound call; validation 422s. Assert the
  outbound request's shape (one request, one question per candidate, names in
  `state.recipes` in index order).
- **Vitest:** `RecipeList` with the hook mocked. The tranche is absent below 3
  characters and when there are no matches. The caption and rule appear with
  both tranches, and the caption without the rule when there are no Exact
  Matches. Exact Matches are never among the candidate ids. Tag filter narrows
  candidates. Pinning stays within each tranche.
- **e2e:** CI has no key, so the feature is off. Add one assertion that
  searching still yields Exact Matches and no "Similar recipes" caption, as a
  guard that the tranche truly is additive. Playwright can't intercept the Go
  API's outbound call, so the Jev path itself is covered in Go, not e2e.
- **PR evidence:** screenshots from a local stack with a real key set: "curry"
  showing both tranches, and a search with zero Exact Matches.

## Deliberately not done

- **Judging method and Ingredient Lines** (filed as its own `future feature`
  row). Names alone are enough to try this. Sending more also widens what the
  privacy entry has to say.
- **A click-through counter** for Similar Recipes. Add it once we want to know
  whether the tranche earns its keep. A metric, not an analytics event.
- **Checking TypeSafe's retention and training terms.** Accepted as unknown for
  now. The privacy wording is written so it doesn't depend on them.
- **An ADR.** Considered for placing this AI call on Fly while every other one
  is on Netlify. Decided against; the reasoning is decision 10 above.
