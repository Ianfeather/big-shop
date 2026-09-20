# Sample-seeded Accounts: never show an empty collection

Implements the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**[#42 — Onboarding: the empty account, not the pitch, is what loses people](https://app.notion.com/p/3bfc724ecda181d9a6a2f4a6100d9ce2)**'s
second concrete piece — see `specs/onboarding.md` for the framework this sits
inside (Stage 2 of "The step-by-step flow"). [Featured Recipes](./completed/featured-recipes.md)
already answered part of #42's seeding question and said so explicitly: it
"must not be given a second answer by it." This spec doesn't — it reuses
`recipe.featured` and `service.CopyFeaturedRecipe` rather than inventing a
second flag or a second copy path.

## What this is

On a brand-new Account's first `POST /user`, copy a small, curated set of
Featured Recipes into it automatically — the same operation the Day 8 email's
link already performs, run for the user rather than waited on. The first
thing a new signup's Recipe list holds is never nothing; it's two or three
real, well-formed Recipes, clearly marked as samples, deletable in one action.

## Why Phase 0 isn't about seeding at all

**Shipping the seed without first fixing what "empty" means elsewhere in the
app breaks a feature that already shipped.** `accountLinkOffer`
(`lib/account-link.ts`) offers account-linking recovery whenever
`recipesResolved && recipeCount === 0` — see `specs/onboarding.md`'s Stage 1
for the full reasoning, but the short version: the moment a new Account is
created with sample Recipes already in it, `recipeCount` is never 0 on day
one, for anyone — a genuine mismatched-identity return included. The
condition built to say "this library is suspiciously empty" becomes
permanently false the instant this feature ships, for every Account, seeded
or not.

So **Phase 0 has to land first, or in the same change**: change what "empty"
means from "zero Recipes" to "zero Recipes the Account actually added."
`recipe.featured_from` already carries this distinction — set on any copy of
curated content, seeded or Day-8-clicked, and null on everything a user
actually wrote or imported themselves.

### Phase 0 — expose "own recipe count"

- `service.Recipe` (`api/internal/pkg/service/recipes.go`) gains a field —
  `Sample bool`, read as `featured_from IS NOT NULL` in `GetAllRecipes`'s
  existing query. A computed expression, not a new column; no migration.
- The frontend `Recipe` type and `useRecipes()` carry it through.
- `pages/list.tsx` computes the count it passes to `accountLinkOffer` (and
  the count Stage 2's welcome will key off) from Recipes where `!sample`,
  not from the raw list length.
- Done when a test proves the offer still fires for an Account holding only
  sample Recipes, and stops firing the instant a real one is added — the
  exact case that's silent today because nothing exercises it yet.

This is useful independent of whether seeding ships at all: [the board item
filed against the current headline-copy collision](https://app.notion.com/p/3e1c724ecda1815e8694e00ff1ba1eff)
needs it too, since "how many Recipes does this Account really have" is the
same question either way.

### Phase 1 — the seed itself

Hook alongside the welcome email, not inside `AddUser` itself: `app/user.go`'s
handler already knows exactly when a row was newly created (`AddUser`'s
`created` return) and already does one best-effort thing in that branch
(`a.sendWelcomeEmail`). Seeding is a second, using the existing
`service.CopyFeaturedRecipe(ctx, slug, caller, db)` once per starter slug —
no new copy logic.

**Open question this phase can't resolve on its own: synchronous, or
best-effort background like the email?** Leaning synchronous — unlike the
email this has no external dependency to fail against (no SendGrid call),
it's two or three fast local transactions, and a `POST /user` that returns
before the seed has landed reintroduces exactly the flash-of-empty-then-
recipes-appear problem Stage 3 of the onboarding flow was designed to not
need a flag for. Worth timing against a real database before deciding, not
assumed.

**A fixed Go slice of "starter" slugs, not "everything `featured = 1`"** —
mirroring the Day 8 email's own pattern of hand-picking specific slugs rather
than deriving from the flag (`specs/completed/featured-recipes.md` Phase 6:
"the flag says eligible, the template says these three"). Onboarding's
curation needs differ from Day 8's — at least one deliberately overlapping
ingredient across the starter set, so the Combine aha's "2 tins" beat
actually lands (`specs/onboarding.md`'s Motivations section), which an
editorially-varied Day 8 pick has no reason to guarantee. A slice, not a new
schema field: swapping the starter set later is a one-line change, no
migration.

**The starter set is decided (2026-09-20): three of the account holder's own
existing Recipes**, not the Day 8 set — chosen and verified against a
production dump (`docker/prod-dumps/prod-sync-1-20260920-183728.sql`) rather
than assumed:

| Recipe | Slug | Recipe id |
|---|---|---|
| Pasta with Beans and Kale | `pasta-with-beans-and-kale` | 9 |
| Pea and Pancetta Pasta | `pea-&-pancetta-pasta` | 17 |
| Apple Crumble | `apple-crumble` | 33 |

**Overlap confirmed by ingredient id, not just by name**: recipe 9 and
recipe 17 both use ingredient 4 (onion), 48 (pancetta) and 571179 (garlic),
each at the same unit (no conversion needed for them to combine on a
generated list — the "2 tins" beat doesn't strictly need a curated Unit Size
here, just the same `unit_id` on both sides, which these already have).
Onion is the one of the three already marked `curated = 1`, so it's the
overlap to lean on if only one needs to be bulletproof. Their "pasta" lines
do **not** overlap — `curly pasta` (id 50) on 9 and `fresh pasta` (id 159) on
17 are different Ingredient rows, so they'll render as two separate lines
rather than combining. Not a blocker, given onion/pancetta/garlic already
deliver the beat, but worth knowing rather than discovering on the first demo
list. Apple Crumble shares nothing with either, which is the point — it's the
variety, not a second overlap.

**Not yet flagged.** All three are `featured = 0` in the dump above — this
list can't be copied by `service.CopyFeaturedRecipe` until an admin flips
`featured` on each, via the existing checkbox in the recipe edit form
(`specs/completed/featured-recipes.md` Phase 2). That's a production write
this spec doesn't make on its own initiative; it's the concrete next action,
separate from writing the Go slice of slugs.

**One slug has a literal `&` in it** (`pea-&-pancetta-pasta`) — worth a
second look when it's hard-coded into the Go starter-slug slice and into
whatever hits `POST /recipe/featured/{slug}`, since that character needs
URL-encoding on the wire even though the stored slug carries it as-is.

### Phase 2 — clearly marked, deletable in one action

- **Marked**: a "Sample" badge wherever a Recipe is listed, driven by the same
  `Sample` field Phase 0 exposes. No new signal.
- **Deletable in one action, and this is cheaper than it looks**:
  `deleteRecipeData` (`service/recipe.go`, the cascade `DeleteRecipe` calls)
  already takes an optional `recipeIDs []int` and deletes every Recipe (and
  its parts, tags, list items and shopping-list events) matching that set
  scoped to the caller's Account — it's the same helper account deletion uses
  with `recipeIDs == nil` for "all of them." A "clear sample recipes" action
  is: look up the caller's Recipe ids where `Sample` is true, and call that
  same cascade with them. No new deletion logic, only a new list-and-call
  wrapper and a route to reach it.

  One consequence worth deciding rather than tripping over: this also deletes
  a Recipe added via a Day 8 email click, which is featured-copy content by
  the same test. That reads as consistent ("remove Big Shop's sample
  content") rather than as a bug, but is worth confirming rather than
  assuming.

  Where the action lives — `/recipes`, `/account`, or both — is open; see
  below.

## Explicitly out of scope

- **The try-before-signup importer.** Deferred per `specs/onboarding.md`'s
  Stage 0 (2026-09-20 update) in favour of a recorded demo; filed separately
  as [`future feature`](https://app.notion.com/p/3e1c724ecda18138bd34d5b4ff71df2f).
  Nothing here needs it.
- **Curating new Ingredients for the starter set.** #42's own caution:
  "whatever is chosen should use Ingredients that are already well-curated
  rather than introducing new ones" is a constraint on which slugs get chosen
  in Phase 1, not new work here.
- **An admin UI for picking the starter set.** A Go slice is enough for one
  admin and a handful of slugs; revisit if that stops being true.

## Testing

- **Go**: Phase 0's `Sample` field on `GetAllRecipes`; Phase 1's seed running
  exactly once per new Account (mirroring `AddUser`'s own once-per-signup
  guard for the welcome email) and being idempotent on a repeat call the way
  `CopyFeaturedRecipe` already is; Phase 2's bulk delete removing every sample
  and nothing else, in one transaction.
- **Vitest**: `accountLinkOffer` still firing for an Account holding only
  samples (the case Phase 0 exists for); the Sample badge rendering only on
  `Sample: true` Recipes.
- **Playwright**: a fresh signup lands on `/list` with the starter Recipes
  already selectable, and "clear sample recipes" returns the Account to a
  genuinely empty state — the two ends of the feature, exercised against a
  real seeded database rather than mocked.

## Open questions

1. ~~Which Recipes, and how many.~~ **Resolved 2026-09-20** — see Phase 1.
   Flipping `featured` on the three in production is still an outstanding
   action, not a decision.
2. **Synchronous seeding vs. best-effort background**, per Phase 1 — a
   timing question, answerable by testing against a real database rather
   than by further discussion.
3. **Where the "clear samples" action lives** — `/recipes`, `/account`, or
   both.
