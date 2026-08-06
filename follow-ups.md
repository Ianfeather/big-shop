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
