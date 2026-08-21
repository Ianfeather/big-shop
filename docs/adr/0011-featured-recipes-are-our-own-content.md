# Featured Recipes are Big Shop's own content, published from an admin's Account

Status: accepted

Big Shop needs a small set of recipes it can put in front of someone who has none — the Day
8 onboarding email promises "a handful of good ones"
([`specs/completed/email.md`](../../specs/completed/email.md)), and
[#42](https://app.notion.com/p/3bfc724ecda181d9a6a2f4a6100d9ce2) wants a new Account to
never show an empty collection. Both need the same thing: recipes that are *ours*, that any
Account can take a copy of.

This ADR records two decisions about that, because a future reader hits both at once and
they only make sense together: **where the content lives** (ordinary Recipe rows in an
admin's own Account, behind a flag) and **where the content comes from** (we write the
method ourselves; we never republish someone else's).

The implementation is specced in [`specs/featured-recipes.md`](../../specs/featured-recipes.md).

## The vocabulary

A **Featured Recipe** is an ordinary Recipe, in an Account whose owner is an admin, that an
admin has flagged as eligible for any other Account to copy. See `CONTEXT.md`.

Two things it is deliberately not. It is **not world-readable** — reading one still requires
a signed-in caller, and "featured" grants eligibility to be copied, nothing more. And it is
**not selected** by the flag: which Featured Recipes appear in the Day 8 email is an
editorial choice made when writing the template, not a consequence of being flagged.

## Where the content lives

**Featured Recipes are ordinary rows in the `recipe` table, in account 1 — a real person's
personal Account — distinguished only by `recipe.featured`.**

That is the surprising part, and it is why this ADR exists. A reader finding production
onboarding content in someone's personal Account will reasonably assume it is a mistake.
It isn't; it is the cheapest arrangement that keeps one property the alternatives lose.

### What the alternatives cost

**A dedicated "Big Shop" Account holding the curated set.** The obvious answer, and the one
that reads best in a diagram. It founders on `account_user`: `CONTEXT.md` records that a
User belongs to at most one Account, so authoring through the app means a second Auth0
identity that exists only to hold recipes — a real `user` row that the lifecycle email
sequence would cheerfully start onboarding unless excluded. Give the Account no members
instead and nothing can log into it, so the recipes can only be authored by migration or
script, which throws away the entire reason for putting them in the database.

**A curated set shipped as data files** (JSON in the repo, `go:embed`ed, imported on
demand). No sentinel Account, no admin flag, and the content is reviewable in a pull
request — genuinely attractive for something with quality and copyright stakes. Rejected
because it is a **second representation of Recipe** that has to be kept in step with the
schema forever, resolves Ingredients and Units by string match at import time (a failure
mode that does not otherwise exist), and makes adding a recipe a deploy rather than a
five-minute product action. Three dishes would not justify that; thirty makes it actively
bad.

**A `starter_recipe` table.** The same shape as `recipe` and `part` under a different name.
This is the shipped-data-files option with a database behind it and none of its benefits.

### What the chosen arrangement buys

**Curation is just using the product.** Import a recipe from a URL, edit it, tag it, tick a
box. No authoring tool, no hand-written JSON, no deploy. When `Recipe` gains a field, the
Featured Recipes have it.

**One mechanism serves both callers.** The copy operation a Day 8 link performs is the same
one that would seed a new Account with samples, which is what #42 asked for and what the
row that split out of it required rather than "a second answer".

**`CONTEXT.md`'s ownership invariant survives literally.** A Featured Recipe belongs to an
Account, like every other Recipe. Nothing needs a carve-out: not the account-scoped
queries, not `service/erasure*.go`, not Dave's "never other Accounts' Recipes" boundary.
The only new concept is a flag.

### The admin flag is a security boundary

`user.is_admin` gates *writing* the flag, and it is enforced in the API rather than by
hiding a checkbox. This is worth stating because the failure mode is not subtle: if the
check lived only in the UI, any user could set `featured` on their own Recipe and inject
content into the onboarding email of every subsequent signup. Reads follow from the same
rule — the add route resolves a Featured Recipe *by the flag*, never by trusting an
identifier in a URL.

`user.is_admin` rather than an `admin_user` table (a one-column table with one row, which
`deleteAccountTx` would then have to clean up on erasure — a column dies with the user for
free) and rather than an environment variable listing Auth0 subject ids (invisible in the
data, changed only by redeploy, and another home for an identifier this codebase keeps in
one place).

### The consequences we are accepting

- **Ordinary edits to account 1 change what new users receive.** Rename or delete a Recipe
  there and the Day 8 email's link changes or dies. There is no staging copy and no audit
  trail; production content is edited by a person logged into production. Acceptable for a
  recipe list, and would not be for anything else.
- **Erasing account 1 would take the Featured Recipes with it.** `deleteAccountTx` deletes
  the Account when its last member erases themselves, and it has no idea any of this exists.
- **The email template and the flag can drift.** Slugs are hand-picked into HTML in the
  repo; the flag lives in the production database. Un-flag a linked Recipe and the link is
  dead, and nothing in CI can catch it, because CI has no access to that database. The
  mitigations are a landing page that fails legibly rather than 500ing, and a runbook line.
- **Reversing this is a migration plus re-curation**, not a refactor. If a second admin ever
  appears, or the set grows past what one person can hold in their head, the dedicated
  Account becomes the right answer and this should be revisited.

## Where the content comes from

**A Featured Recipe's method is written by us. Ingredient lines may come from anywhere,
including URL Import; the method prose may not.**

Importing someone's recipe into your own Account to cook from is personal use. Flagging it
Featured is **distribution** — it is then sent to every new user and copied into their
Accounts as Big Shop's own onboarding content. Those are different acts and the second one
needs the content to be ours.

The line drawn here is the conventional one in recipe publishing: a list of ingredients is a
statement of fact, and the method prose is the copyrightable expression. So URL Import stays
useful — it is how the structure and the ingredient lines arrive — and rewriting the method
is the step that happens before the flag goes on. This is a deliberate, recorded position
and not legal advice; if the set ever becomes commercially significant it deserves a
lawyer's line rather than this paragraph.

Two supporting rules follow from it:

- **`remote_url` is not copied.** `components/recipe/index.tsx` renders it as an outbound
  link, so copying it would put a link labelled as the recipe's source next to a method that
  deliberately differs from what is at the other end of it. It stays on the Featured Recipe
  as the curator's own provenance record. Where crediting a source is the decent thing, it
  goes in `notes` as a written line — an editorial choice, not a URL the importer happened
  to leave behind.
- **Third-party content stays out of the lifecycle emails**, which
  [ADR-0010](./0010-lifecycle-email-lawful-basis.md) already requires
  ("no third-party content") as a condition of the legitimate-interests basis. Recipes we
  wrote satisfy it; recipes we forwarded would not.

## Consequences

- The Day 8 email stops being inspiration-only and can link to something that acts. The
  copy changes with it; the non-promotional condition in ADR-0010 §"What the position is
  contingent on" is unaffected, because linking to a page of our own product is what the
  rest of the sequence already does.
- Curating a Featured Recipe now has a required manual step — writing the method — which is
  the main ongoing cost of this decision and the one most likely to be skipped under time
  pressure. The flag is the moment to check it.
- #42's seeding piece inherits all of this and should not design its own answer.
- **Cross-Account visibility is still forbidden.** Nothing here lets one user's Recipe be
  read by another Account. The general user-to-user share link is a separate, larger
  decision, filed as
  [Sharing a Recipe with someone outside your Account, by link](https://app.notion.com/p/3c3c724ecda181a1af74cbce5c0c9a42).
