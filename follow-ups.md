# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30, 32, 33 and 36 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

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

39. **Shopping List amounts are far more precise than anyone can shop.** The list
    currently renders things like `4.444444 teaspoon (10 gram)` and `2.222222 teaspoon
    (5 gram)` — the raw result of a unit conversion, printed in full. Nobody measures
    4.444444 of anything into a trolley.

    Two separate decisions hide in here, which is why this is its own item rather than a
    quick `toFixed`:

    - **How much precision to display.** One decimal place is probably right as a floor
      (`4.4 teaspoon`), but the rule can't be blind: `0.25 teaspoon` is a real quantity a
      cook recognises and `0.3 teaspoon` isn't, and rounding `1.04 kg` to `1 kg` is fine
      where rounding `0.4 kg` to `0` is a bug. Halves and quarters read better than
      decimals for spoons and cups.
    - **When to round *up* instead of to-nearest.** For anything you buy as whole units —
      spoons of a spice you're measuring out, tins, lemons — rounding down means going
      home without enough. The existing Display Unit work already rounds tins up (see the
      e2e test "a weight is shown in tins, rounded up to a whole one"), so there is a
      precedent to follow rather than a new principle to invent.

    Worth deciding at the same time: whether this is a display concern in
    `components/shopping-list/ShoppingList/Item.tsx`'s `formatAmounts` (cheap, and keeps
    the underlying totals exact for further combining) or a property of the combining
    itself in the Go API (`netlify-functions/recipes`). Display-side is the safer default:
    round once, at the end, where a human reads it.

40. **URL import returns an empty `ingredients` array for some recipe sites.** Reproduced
    on <https://www.bbcgoodfood.com/recipes/chicken-tzatziki-wraps>; reported for "a couple
    of URLs", so it is not one broken page. The import completes and the form opens — the
    Recipe just arrives with nothing in it, which is worse than a visible failure, since
    it looks like the site had no ingredients rather than like the extractor missed them.

    Where to start: `lib/recipe-import/*` (the extractor, plain untyped `.js` with a
    sidecar `.d.ts`) and `pages/api/parse-recipe-url.ts`. The two things to separate
    before concluding anything are (a) the fetch/extract step returning nothing — most
    likely the page's JSON-LD shape changed, or it's now behind bot protection — versus
    (b) extract succeeding and the LLM step dropping the ingredients on the floor.
    Logging the intermediate payload for one known-bad URL answers that in one run.

    Note that the e2e coverage for import (`e2e/recipe-import.spec.ts`) intercepts
    `/api/parse-recipe-url` and returns canned JSON, deliberately — it covers everything
    between the extractor and the save payload, and so cannot catch this class of bug by
    design. Whatever the fix is, the regression test for it belongs next to the extractor,
    against a saved copy of a real page.

41. **Backfill the Method on existing Recipes.** A good number of Recipes in the catalog
    have ingredients but an empty `method` — imports that only ever captured half the
    page, and older hand-entered ones. The detail page now shows the empty Method section
    with a pencil beside it (rather than hiding it, which made a missing method
    indistinguishable from one that simply wasn't displayed), so this is visible rather
    than silent — but the data is still missing.

    Worth establishing before doing anything bulk:

    - **How many, and which.** Measured on a local copy synced from production
      (2026-08-05): **136 of 157 Recipes have no method at all.** That is most of the
      catalog, so this is not an afternoon of typing — whatever happens has to be
      largely automated, and has to be safe to run more than once.
    - **Where the text comes from.** Recipes carrying a `remote_url` can plausibly be
      re-fetched through the existing import path, which is the cheap case — but see #40,
      since that path is currently returning empty ingredients for at least some sites,
      and a re-import that silently overwrites good ingredients with nothing would be
      worse than the missing method. Recipes with no URL have no source but the cook.
    - **Never overwrite a non-empty field.** Whatever runs, it should write `method` only
      where `method` is currently empty, and touch nothing else on the row.

    Related but separate: `parseMethodSteps` in `components/recipe/index.tsx` splits
    "1. … 2. …" prose into steps at render time. If a backfill is going to write method
    text anyway, it is the natural moment to decide whether steps should be stored as
    structured data instead — the comment there has called the parsing a stopgap since it
    was written.
