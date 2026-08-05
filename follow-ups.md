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

36. **Put the brand back into the Shopping List.** The "Cookbook" redesign (paper, ink,
    terracotta labels) fixed the boxiness of `/list`, but it went too far the other way:
    the page is now almost monochrome, brand purple has been reduced to a spot colour on
    hover states, and every control is an underlined text action. It reads as considered
    but anonymous — nothing on it says Big Shop, and there is no button with any presence.

    Six places to put colour and weight back, roughly in order of how much each buys:

    - **The checkbox.** It's the control you touch most on the page and it's currently a
      grey circle that fills ink when bought. Purple on hover and on bought would put the
      brand into the main interaction rather than into decoration.
    - **A real primary button.** "Add" (non-recipe items) is an underlined text link and
      "Clear list" is another; a solid purple Add would restore the button presence the
      page lost, and give the rail a focal point.
    - **Selected recipes in the rail.** Ticked rows are a beige block today. Purple-tinted
      with a purple tick would visibly tie the rail to the list it generates.
    - **The masthead count.** "2 recipes · 7 items" is grey small-caps; as a purple pill it
      anchors the top of the page in brand colour.
    - **Department dividers.** The list is already sorted by aisle (see
      `DEPARTMENT_ORDER`) but never says so. Small coloured aisle headings would add
      personality *and* surface information the sort order is silently encoding — the one
      item here that is a feature rather than a paint job.
    - **The empty-basket illustration.** Already the only purple on the page, now sized
      down beside the copy. Worth deciding whether it earns a bigger role rather than
      being the last survivor of the old palette.

    Not a redesign: the one-sheet layout stands. The question is only where colour and
    weight go back on top of it. Whatever is picked, `/dave` should be looked at in the
    same pass — it kept its white card and its own blue palette through the redesign and
    now looks like a different product (see the `--color-info` note in
    `pages/dev/design-system.tsx`).
