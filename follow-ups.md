# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30, 32, 33, 36, 39 and 40 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

Items 34 and 35 have moved to [`known-issues.md`](./known-issues.md): they are real but deliberately not being fixed, so they are not queued work.

31. **Buying preference: prefer fresh fruit over bottled juice.** For when automated
    buying exists. A Recipe asking for lemon juice, lime juice or orange juice should be
    satisfiable by buying the fruit rather than a bottle, as a user-level preference
    rather than a hard rule.

    The catalog already models most of what this needs, which is why it is worth writing
    down now rather than discovering later. `lemon juice` has a Base Unit of millilitre,
    and a Unit Size on a whole `lemon` records how much juice one fruit yields — that is
    the same mechanism that lets "3 onions" combine with "150g onion" (see CONTEXT.md's
    Unit Size). So the conversion "45ml lemon juice" -> "1 lemon" is already expressible;
    what is missing is a link saying *this Ingredient can be produced from that one*, and
    a preference saying which side to buy.

    Deliberately not a merge. `lemon` and `lemon juice` are different Ingredients and
    should stay so — the recipe genuinely wants juice, and a shopper buying for a recipe
    that needs lemon zest as well needs the fruit. The preference belongs at buying time,
    where it can be turned off, not baked into the catalog where it cannot.

    Worth checking when this is picked up: whether the yield Unit Sizes actually exist on
    `lemon`, `lime` and `orange` yet, since `030` merged `freshly squeezed lemon juice`
    into `lemon juice` but did not add any.

37. **Threshold-based alerting, once there are baselines to set thresholds from.**
    Deliberately deferred when the observability stack was designed (see
    [ADR-0007](./docs/adr/0007-observability-otel-grafana-cloud.md)): alert thresholds picked
    before anyone knows Big Shop's actual error rate and latency distribution are usually
    wrong in both directions, and on a project with an on-call rota of one person, an
    alert that has been learned-to-ignore is worse than no alert.

    Two rules are wanted, both symptom-based rather than cause-based:
    - **Backend 5xx rate** above a floor, across `bigshop-api` and `bigshop-web` together.
    - **Frontend error rate spike** from Faro.

    Explicitly *not* wanted as alerts, however tempting: DB latency, cold-start frequency,
    per-endpoint p99 regression, LLM failure rate, OpenAI spend. Those are causes you look
    at on a dashboard *after* something fires, not things that should wake anyone up.

    **The trigger is data, not a date** — roughly two weeks of production telemetry, i.e.
    enough to know what a normal day's error rate and p99 look like. Nothing here is
    blocked on more instrumentation; the traces, metrics and logs it needs all land with
    the initial work.

    Not deferred, and already shipped alongside the instrumentation: the synthetic
    uptime check on `/health`, plus the fix making `/health` actually query TiDB rather
    than unconditionally writing `ok`. That one is a binary up/down signal, so "wait for
    baselines" never applied to it.

38. **`/dave` is still on the pre-redesign design.** Split out of #36, which put the brand
    back into the Shopping List but deliberately left Dave alone. It kept its white card
    and its own blue palette (`--color-info`) through the "Cookbook" redesign and now
    looks like a different product — more so than before, since `/list` has moved again
    since.

    What #36 settled that this should follow: paper rather than a white card, purple for
    the controls you touch and for anything selected, lowercase `--font-heading` section
    headings rather than letter-spaced small caps, and terracotta reserved for those
    headings. The open question is what happens to `--color-info` itself: it exists only
    for Dave's chat UI (see its note in `pages/dev/design-system.tsx`), so this pass
    either finds it a real role or deletes the token.

    Note from Ian: I think it makes more sense to make dave a modal or integrate it into the other pages rather than it being its own page.

41. **Backfill the Method on existing Recipes — the 80 with no page to re-read.**
    Reduced rather than resolved. The automatable half is done: `scripts/backfill-recipe-method.mjs`
    re-read every Recipe carrying a `remote_url` through the app's own URL Import
    path and generated [`migrations/031_backfill_recipe_method.sql`](./migrations/031_backfill_recipe_method.sql),
    **56 methods**, verified byte-exact against a local copy of production and applied
    to production on 2026-08-06. See `docker/README.md` for how to run it. What is left
    is what no script can reach:

    - **68 Recipes have no URL at all**, and no source but the cook. Six of those use
      `remote_url` for a cookbook rather than a link ("From the Pie Room cookbook",
      "Deliciously Healthy Fertility by Ro Huntriss"), which is a source, just not a
      fetchable one. Every one of the 68 is listed by name in 031's footer.
    - **12 have a URL that could not be read** — dead links, paywalls and bot
      protection, one page (Yorkshire Puddings) that genuinely carries no method.
      Also listed by name in 031's footer, with the reason for each. Worth a second
      look before hand-typing: some may be fixable in the extractor rather than in
      the catalog, the way #40 was.

    Re-running the script is the right move after any extractor improvement — it is
    safe to run repeatedly, only ever writes to a `method` that is still empty, and
    will simply pick up whatever has become readable since.

    Still open, and still separate: `parseMethodSteps` in `components/recipe/index.tsx`
    splits "1. … 2. …" prose into steps at render time. 031 has now written 56 methods
    in exactly that shape, so the stopgap is more load-bearing than it was — which
    sharpens the question of whether steps should be stored as structured data, rather
    than settling it.

42. **Onboarding: the empty account, not the pitch, is what loses people.** Raised while
    reviewing the marketing page (2026-08-06). The page itself now says the right things,
    but the funnel behind it is: read the page → sign up through Auth0 → land in an
    account holding **nothing**. Every claim the page makes — the adding-up, the aisle
    order, "2 tins" — needs several Recipes to be visible at all, so the first session
    delivers none of it and asks for data entry instead. No amount of copy fixes that;
    this is where the work is.

    A bucket rather than a single task. Two concrete pieces are worth doing first:

    - **Let someone import a recipe before they have an account.** A URL box on the
      logged-out homepage that runs the real extractor and shows what came back — name,
      ingredients, method — with "save it" as the thing that triggers signup. It answers
      the biggest unspoken objection ("will it work on the sites *I* use?") by letting
      them test it rather than be told, and it means the first thing in the account is a
      recipe they chose. `pages/api/parse-recipe-url.ts` already does the work; what is
      missing is an unauthenticated path to it and, necessarily, rate limiting — it is an
      LLM call on a public endpoint, so this cannot ship without a per-IP cap and a
      sensible cost ceiling. It also needs a real failure state rather than silence: #40
      is fixed, but #41 found 12 URLs the extractor still cannot read (dead links,
      paywalls, bot protection), and a public try-it box that returns nothing at all for
      one of those is worse than no box — it reads as "this doesn't work" on the one
      screen where that conclusion is fatal.
    - **Never show an empty collection.** Seed a new Account with a small set of good
      Recipes — clearly marked as samples, deletable in one action — so the very first
      thing a user can do is tick three boxes and see a real combined list. The seeding
      mechanics already exist for local dev (`docker/mysql-seed/dev-seed.sql`); what does
      not exist is a production path, or a decision on where the sample Recipes come from
      and who owns them. Note the interaction with the Global Catalog: sample Recipes
      create real Ingredient Lines, so whatever is chosen should use Ingredients that are
      already well-curated rather than introducing new ones.

    Other onboarding threads not designed yet, listed so they are not re-discovered:
    what the first run of `/list` shows when nothing is selected; whether the invite flow
    should be offered during onboarding rather than buried in `/account`, given that a
    shared list is the strongest reason to keep using it; and whether the one-shot
    onboarding screen in `pages/index.tsx` (shown once, then marked onboarded in the
    background) is worth keeping at all if the two items above land — it currently exists
    only to say "you're in" to someone who has nowhere to go yet.
