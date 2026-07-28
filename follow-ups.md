# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–29 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

30. **Audit TanStack Query cache invalidation properly.** `invalidateQueries` appears
    **nowhere** in this codebase. Every mutation — save Recipe, delete Recipe, mark an
    item bought, add an Extra Item, clear the Shopping List, invite a user — writes
    through the API and leaves every cached query untouched.

    Most of it gets away with that by navigating afterwards, which remounts the consumer
    and refetches (no `staleTime` is set, so the default of `0` means a remount always
    refetches). That is luck rather than design, and it has already failed once: the
    Recipe Import prompt's known-ingredient list was read from the `['ingredients']`
    cache, so saving a Recipe that created new Ingredients left the *next* import unaware
    of them, and the model would coin a second name for something created moments
    earlier — precisely the catalog fragmentation migration `029` exists to undo. That
    instance is now fixed structurally, by reading the list server-side in the API route
    (`lib/recipe-import/known-names.ts`) instead of from a client cache. The bug is gone;
    the gap that produced it is not.

    Worth one deliberate pass rather than case-by-case, because the question is identical
    everywhere: for each mutation, which `queryKey`s should it invalidate, and is
    anything relying on a navigation to paper over the answer? Live candidates:

    - `['recipes']` after save/delete — currently survives on `router.push`.
    - `['units']` after an import introduces a new Unit: the same shape as the
      `['ingredients']` bug that already bit.
    - `pages/list.tsx` keeps Shopping List state in `useState` alongside its mutations
      rather than deriving it from a query at all, so it is a different question again —
      does it want a cache, or is local state right for a page that is already the only
      writer?

    Be deliberate rather than reflexive: sprinkling `invalidateQueries` everywhere trades
    silent staleness for extra refetches on a page that already re-renders plenty. The
    output should be a decision per mutation plus a line in `technical-architecture.md`
    recording the convention, not a blanket sweep.

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
