# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30, 32 and 33 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

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
