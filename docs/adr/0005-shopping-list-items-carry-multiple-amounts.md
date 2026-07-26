# A Shopping List Item carries one or more Amounts

Status: accepted

A Shopping List Item used to carry exactly one quantity and one Unit. It now carries **one or more Amounts**, so a line can read "flour — 50 g + 2 tbsp" when those quantities can't be combined for want of a Unit Size. It remains one line, one checkbox, one Department: the change is to the Item's contents, not to what counts as an Item.

This exists because the alternatives when a group can't be merged are both worse. Picking one sub-group and dropping the rest silently loses ingredients the cook needs to buy — the same class of failure as the aggregation bug this work fixes. Converting anyway using an assumed density produces a single confident number that can be off by 2× for light solids, with nothing on screen to signal it. Showing both Amounts is never wrong, and the line silently improves to a single Amount the moment a Unit Size is supplied.

## Consequences

- **The name-as-key rule survives intact.** An Item is still identified by its display name alone. `list` needs no schema change — it has no unique constraint on `name`, and `BuyListItem`'s `WHERE name = ?` already updates every row sharing a name, so several Amounts toggle as one checkbox by construction.
- **The API response shape changes**, which is the expensive part to undo: `common.ListIngredient`, `GetIngredientListItems` (which must now group rows by name), the TypeScript types, and `Item.tsx`.
- Multiple Amounts are a **normal state, not a degraded one**. Some things genuinely never merge, and the design leans on this: it's what allows a new Ingredient with no curated data to appear on a list immediately, and what makes the curated seed and runtime classification optional rather than blocking.
- An unparseable quantity now surfaces as its own verbatim Amount instead of being silently skipped, which is the same principle applied to a different failure.
