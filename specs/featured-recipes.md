# Featured Recipes: a link in an email that puts a Recipe in your Account

Implements the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**Adding a Recipe to your list from a link in an email**, which was split out of
[#50](https://app.notion.com/p/3c1c724ecda1814cae3bc27906bc5ede) during Phase 1 of
[`specs/completed/email.md`](./completed/email.md) because the Day 8 email promised
something no mechanism existed for. Establishes
[ADR-0011](../docs/adr/0011-featured-recipes-are-our-own-content.md), which holds the two
decisions that outlive this spec — where featured content lives, and that we write it
ourselves. Partially answers
[#42](https://app.notion.com/p/3bfc724ecda181d9a6a2f4a6100d9ce2)'s seeding piece and must
not be given a second answer by it.

## What this is

A **Featured Recipe** is an ordinary Recipe in an admin's Account that an admin has flagged
as eligible for any Account to copy. The Day 8 email links to one. Clicking the link copies
it into your Account and lands you on your copy.

That is the whole feature. Everything below is the consequence of it having to work for
someone who is not logged in, on a phone, eight days after they signed up.

## The problem the original row could not solve, and why it dissolved

The row was parked on a design question: *a link in an email is clicked by someone who may
not be signed in, so identifying the user and the Recipe from the URL alone means a per-user
token in a URL* — which collides head-on with #50's rule that no user or account identifier
ever appears in a lifecycle email link, and with the unsubscribe design's deliberate refusal
to mint our own tokens.

**Both options it listed assumed the link had to carry identity. It does not.** The thing the
URL names is a Recipe *Big Shop published* — content, not a person. So the link is an
ordinary unguarded URL, the identity comes from the session exactly as it does everywhere
else in the app, and there is no token, no public endpoint, no migration for a token store,
and nothing in a mail provider's logs that identifies anybody.

What the row got right is that a logged-out click is the hard case. That is Phase 3.

## Current state (why this isn't greenfield)

- **The Day 8 email exists and is honest about the gap.**
  `netlify-functions/recipes/internal/pkg/service/email/templates/recipes.html` describes
  three dishes in prose and links to `/recipes`. Its comment block says the three are
  placeholders and that "one click to add" is not built. Both halves change here.
- **`recipe` already carries `slug varchar(60)`** and `remote_url`, `notes`, `method`, plus
  tags and `part` rows. There is no image. `GetRecipeBySlug` (`service/recipe.go:74`) scopes
  `slug = ? AND account_id = ?`, so **slugs are unique per Account at most, never globally**.
- **`AddRecipe` (`service/recipe.go:330`) already does the copy** in all but name: it takes a
  `common.Recipe`, slugifies the name, and writes the recipe row with its ingredient, unit,
  part and tag rows in one transaction under `caller.AccountID()`.
- **`Caller` (`common/caller.go`) resolves the Account lazily and memoises it**, deliberately,
  so routes that don't need it pay nothing. Admin resolution follows the same pattern for the
  same reason — two routes need it and twenty-odd don't.
- **Nothing is admin-aware.** There is no `is_admin`, no role, and no production admin
  surface: `pages/dev/*` returns `notFound` when `NODE_ENV === 'production'`.
- **Deep links do not survive login.** `hooks/use-login.ts` hardcodes
  `redirect_uri: appOrigin()`, nothing anywhere uses Auth0's `appState`, and `pages/_app.tsx`
  bounces any non-public route with `router.push('/')`, discarding the route it bounced. A
  logged-out click on a deep link today lands on the marketing homepage **with no login
  prompt at all**, and logging in from there lands on `/` too.
- **`lib/analytics/events.ts` has four events and means to keep it that way.**
  `RecipeSource` is `'url' | 'photo' | 'text' | 'manual'` and the file states its own
  contract: it describes *how Recipes arrive*.

## Proposed approach

### Phase 1 — The schema and the flag

`migrations/042_featured_recipes.sql`:

- `user.is_admin` — `tinyint(1) NOT NULL DEFAULT 0`. Granted by hand; there is no UI and
  will not be one while there is one admin.
- `recipe.featured` — `tinyint(1) NOT NULL DEFAULT 0`, plus an index. Means *eligible to be
  copied by any Account*, and nothing else — in particular it does not mean "appears in the
  Day 8 email", which is decided in the template.
- `recipe.featured_from` — nullable `int` referencing `recipe(id)` **`ON DELETE SET NULL`**.
  Records which Featured Recipe a copy came from. The delete rule is load-bearing in both
  directions: without it the FK would refuse to let you ever delete a Featured Recipe that
  anyone had taken, and `deleteAccountTx` would fail on any Account holding one.

  Verify the self-referencing FK actually applies on TiDB before relying on it — migration
  041 added FKs so the support is there, but a self-reference is the untested case. The
  fallback is a plain `int` with no constraint, which costs the guarantee that
  `featured_from` always points at something real.

Seed data: `docker/mysql-seed/dev-seed.sql` gives `local-dev-user` `is_admin = 1` and marks
one of its two sample recipes `featured`. Note the consequence deliberately — under
`NEXT_PUBLIC_DISABLE_AUTH` the mock user is therefore an admin, which is what makes the
flow testable locally and in e2e, and is wrong to copy into any environment that matters.

### Phase 2 — The admin gate, and setting the flag

**`Caller.IsAdmin()`**, lazily resolved and memoised, mirroring `AccountID()` and for the
identical stated reason: only the recipe write path and the featured read need it.

**`featured` rides on the existing Recipe create/update payload.** No new endpoint. The rule
in the service layer:

> A request that **changes** `featured` from its stored value requires `IsAdmin()`. A request
> that submits it unchanged does not.

Reject with a 403 rather than silently ignoring the field — an ignored write is a bug that
looks like a working feature. The unchanged-value exemption exists so that an ordinary user
editing their own Recipe, whose client dutifully round-trips every field, is not 403'd for
sending `featured: false` back.

**This is the security boundary.** Hiding the checkbox is presentation; if the check lived
only in the UI, any user could flag their own Recipe and put their content into every
subsequent signup's onboarding email.

**UI**: a checkbox in the recipe edit form (`components/recipe-form/Form.tsx`), rendered only
for an admin. The user's admin-ness comes from the existing user payload
(`GET /user` → `pages/api`… via `hooks/use-user`); adding `isAdmin` to it is the smallest
change. Make the flag legible on the Recipe itself too, not just in the edit form — the
curator needs to see at a glance which of their recipes are live to strangers, because
ADR-0011 accepts that ordinary edits to those rows change what new users receive.

### Phase 3 — Return-to through Auth0

General infrastructure, built here because this is the product's first deep link and
therefore the only thing that can exercise it. Three parts:

1. `pages/_app.tsx`'s gate stops discarding the route it bounces. It records the attempted
   path before `router.push('/')`.
2. `hooks/use-login.ts` passes `appState: { returnTo }` to `loginWithRedirect`.
3. The callback honours `appState.returnTo` and navigates there. `lib/auth-callback.ts`
   already reasons carefully about the callback arriving with `?code=&state=` and being
   rewritten by `history.replaceState` before any component renders — read it before
   touching this, because the same race applies.

**Only same-origin relative paths are accepted as a return target.** A `returnTo` that can
be steered to an absolute URL is an open redirect, and it would be reachable from a crafted
link. Validate it as a path, not a URL.

### Phase 4 — The copy, and the route

**`POST /recipe/featured/{slug}`** — "give me a copy of this Featured Recipe". Authenticated
like every other route; three path segments, so no collision with `GET /recipe/{id}`.

Resolution is **by the flag**, never by trusting the identifier: `WHERE slug = ? AND
featured = 1`. Note the admin check does not appear here — the flag is set by an admin and
is the record of that decision; a curator later losing admin does not un-publish what they
published.

Because slugs are not globally unique, the lookup can match more than one row. **Error
loudly** rather than picking one — it means two Featured Recipes share a name, which is a
curation mistake to be told about.

The copy itself is `AddRecipe` with three adjustments, and the seam needs a moment's thought
because `AddRecipe` owns its own transaction:

- `RemoteURL` blanked (ADR-0011: the method is ours and differs from whatever is at the far
  end of that link).
- `featured` **not** copied. A recipient's copy must not itself be publishable — they are
  not an admin, so it would be an orphaned privilege.
- `featured_from` set to the source id, in the **same transaction** as the insert. A copy
  that commits without its provenance is a copy that will be silently duplicated on the next
  click.

Everything else copies: name, slug (re-derived from the name by `Slugify`, so it matches),
method, `notes`, tags, and every ingredient line. `classifyNewIngredients` is a no-op here by
construction — a curated Recipe's Ingredients all exist already — which is the mechanical
reason a Featured Recipe's Shopping List behaviour is the one you saw when you curated it.

**Already-taken is a no-op**: if a Recipe in the caller's Account already has
`featured_from = <source id>`, return that one. Deleting your copy and clicking again
correctly gives you a fresh copy, because the provenance went with it.

### Phase 5 — The landing page

`pages/recipes/add/[slug].tsx`. Behind the existing auth gate. On mount it POSTs, then
replaces itself with the user's copy at `/recipes/[id]`.

Three states, and the third is the one that gets skimped:

- **Added** — land on the copy. A brief confirmation that this is now yours.
- **Already had it** — land on the same copy. Say so; arriving somewhere with no explanation
  reads as a bug.
- **No such Featured Recipe** — a real page saying the recipe isn't available, with a way
  onward into the app. Not a 500, not a silent bounce to `/`. This state is **expected, not
  exceptional**: ADR-0011 accepts that the template's hand-picked slugs can drift from the
  flag with nothing in CI able to catch it, and this page is the mitigation.

A page title entry in `lib/analytics/page-titles.ts` is required — a test reads the `pages/`
directory and fails the build for a route without one.

### Phase 6 — The email

Rewrite `templates/recipes.html`: keep the editorial prose, which is the reason the email is
worth reading and the reason ADR-0010's non-promotional basis holds, and point each dish at
`/recipes/add/<slug>` with the existing `utm_*` campaign parameters. Delete the comment block
explaining why this doesn't exist. Regenerate `testdata/recipes.golden.html`.

The three dishes stop being placeholders and become three real Featured Recipes, curated per
ADR-0011 — imported for structure, method rewritten, ingredients checked.

**Slugs are hand-picked into the template.** That is the editorial selection, and it is
deliberately not derived from the flag: the flag says *eligible*, the template says *these
three*.

### Phase 7 — Counting it

Add `'featured'` to `RecipeSource` in `lib/analytics/events.ts` and fire `recipe_imported`
on a successful add. No new event.

The justification belongs in that file, since it enforces its own rule: omitting a fifth way
Recipes arrive would leave `recipe_imported` looking like a total when it no longer is, so
"what share of Recipes arrive by URL" would drift as featured adds grow with nothing in the
data explaining why. Per ADR-0008 §1 the parameter is one word from a closed set — no name,
no slug, no id. Note in the same place that `RecipeSource` now diverges from Import Source
as well as from `lib/telemetry/metrics.ts`'s `ImportSource`: a featured add chooses no
source and is not an Import Source at all.

**No new counting of the email side.** `featured_from` answers "did anyone use the Day 8
links" from our own database, and ADR-0010 forbids click tracking in these emails anyway.

## Testing

- **Go**: the featured lookup (found / not featured / ambiguous slug), the copy (fields
  carried and dropped, provenance set), the already-taken no-op, and the admin gate —
  including the case that must *not* 403, a non-admin submitting `featured` unchanged.
- **Vitest**: the admin checkbox renders only for an admin; the landing page's three states.
- **Playwright**, in a new `e2e/featured-recipe.spec.ts`: the logged-out journey end to end —
  hit a featured link while signed out, come back through login, land on the copy — plus the
  second-click no-op. This is the only thing that exercises Phase 3, which is the whole reason
  return-to is built here rather than separately.

  **It must not touch the Shopping List**, so it can run alongside `shopping-list.spec.ts`.
  It has no reason to, since the feature deliberately doesn't.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **A click adds to your Recipes, never to the Shopping List.** The List is one mutable
  resource shared by the whole Account. Day 8 lands at 10:00 local; if a link tapped over
  coffee silently changed what someone else was holding in the shop, that is a worse failure
  than any convenience it buys. An explicit "and add to this week's list" button on a preview
  screen would be a legitimate later addition; automatic is not.
- **The add is automatic on arrival**, not a preview-and-confirm. The user lands on
  `/recipes/[id]`, which is already the structured view, and an unwanted Recipe is one delete
  away. The `GET`-triggers-a-write objection is answered by the auth gate — mail scanners and
  link prefetchers are not signed in — and by the no-op on the second visit.
- **The link carries the slug, not the id.** Mail clients show the destination on hover and
  every provider in the path logs it; `pasta-e-ceci` explains itself where `812` reads as a
  tracking parameter, which is the exact impression a legitimate-interests email should not
  give. A sequential int also discloses roughly how many Recipes exist system-wide.
- **`recipe.featured` is a boolean, not a position.** Ordering would only matter if the email
  were generated from the flagged set, and it isn't — see Phase 6.
- **Catalog quality is curator discipline, not a check.** A Featured Recipe whose Ingredients
  lack Unit Sizes shows uncombined Amounts on a new user's first list, which is the worst
  place for it. There is no validation because the check requires no code: the Global Catalog
  is shared, so generating a list from what you just featured shows you exactly what a new
  user will see. That is the runbook line. Revisit if there is ever a second admin, when the
  person flagging may not be the person who knows the catalog.
- **`user.is_admin` column**, not an `admin_user` table (one row, and `deleteAccountTx` would
  have to clean it up) and not an env var of Auth0 subject ids (invisible in the data,
  changed only by redeploy).

## Explicitly out of scope

- **Cross-Account sharing of a *user's* Recipe.** Filed as
  [Sharing a Recipe with someone outside your Account, by link](https://app.notion.com/p/3c3c724ecda181a1af74cbce5c0c9a42),
  tagged `future feature`. It needs Recipe visibility outside its Account, which is an
  ADR-sized change this deliberately does not make.
- **Any unauthenticated view of a Featured Recipe.** Day 8 goes to people who signed up eight
  days ago, so every recipient has an account. A public preview would serve forwarded links
  and pre-signup browsing — #42's try-it-first box — and would cost the first public endpoint
  in the Go API plus its rate-limiting and caching decisions.
- **Seeding a new Account with samples.** #42's own piece. It should use this flag and this
  copy operation and should not design a second answer.
- **An admin UI beyond one checkbox.** No curation dashboard, no preview-as-new-user, no
  ordering.
- **Any change to how the Shopping List is generated.**

## Things to get right when building this

- **The 403 rule is "changed", not "present".** Getting this backwards 403s every ordinary
  user editing their own Recipe, because the client round-trips the whole object.
- **`featured_from` must be written in the insert's transaction.** Outside it, a crash
  between the two writes produces a copy with no provenance, which duplicates silently on the
  next click — the exact bug this column exists to prevent.
- **Validate `returnTo` as a relative path.** Anything that accepts an absolute URL is an open
  redirect reachable from a crafted link.
- **Don't copy `featured`.** A recipient's copy that is itself featured is a privilege
  escalation with no UI to notice it by.
- **Regenerate the email golden file.** `testdata/recipes.golden.html` is asserted against.
- **Add the `page-titles.ts` entry** for the new route, or the build fails on a test that
  reads the `pages/` directory.
- **The e2e suite tears down its volumes every run**, so migration 042 applies cleanly there
  from the start. A local dev database will not re-run it — `docker compose down -v` and let
  it reseed.

## Open questions

1. **Whether the self-referencing FK on `recipe.featured_from` behaves on TiDB.** Decided in
   Phase 1 with a stated fallback; verify rather than assume.
2. **What happens to a copy when the Featured Recipe it came from is edited.** Nothing, by
   design — a copy is a snapshot. Recorded because it will be asked, and because the
   alternative (propagating edits) is a different feature with a different name.
3. **Whether the runbook line lives with the email runbook or on its own.** Curating a
   Featured Recipe is not email testing, but it is currently only ever done for an email.
   `docs/email-testing-runbook.md` is the pragmatic home until #42's seeding gives it a
   second caller.
