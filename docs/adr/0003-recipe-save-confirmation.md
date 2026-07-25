# Recipe save confirmation: redirect to detail page with a toast, not inline "Stored!" text

After creating or editing a Recipe, `Form.tsx` will redirect to `/recipes/{id}` (mirroring how Delete already redirects to `/recipes`) rather than staying on the form with an inline "Stored!"/"Updated!" message and no redirect at all. The redirect carries a one-time `?stored=new|updated` query param, consumed once on the detail page's mount and then stripped via `router.replace`, which triggers a new generic `Toast` component (`components/toast/`, the first of its kind in this codebase) — a full-width banner at the top of the page reading "Recipe saved", dismissed manually only (no auto-hide timer). This applies uniformly to both create and edit, replacing today's two divergent, in-place, easy-to-miss confirmations with one mechanism whose destination page is unambiguous proof the Recipe was actually stored.

## Considered Options

- Stay on the form page and just upgrade the inline text into a toast — rejected: landing on a fully-rendered, real Recipe (identical to any other) is a stronger confirmation signal than any in-place message, and is the whole reason the current experience reads as weak/ambiguous.
- Auto-dismissing toast (the typical pattern) — rejected in favor of manual-dismiss-only: a deliberate choice to prioritize not missing the confirmation over conventional toast brevity.
- Corner-floating toast overlay — rejected in favor of an in-flow, full-width banner, to avoid overlay/z-index handling and to read as clearly tied to the specific page rather than a global/floating notification.
- Passing the "just saved" flag via React context or `sessionStorage` instead of a URL query param — rejected: the query param needs no new app-level state, and is trivially testable/inspectable (including from Playwright).
- Scoping this to create only (item 15's literal wording) — rejected: edit had the exact same divergent, no-redirect, inline-message pattern, and giving it a separate mechanism would leave `Form.tsx` with two different post-save behaviors depending on `mode`.

## Consequences

- The existing in-place "Add another recipe" flow (reset the form without navigating) is removed. "Add new recipe" moves from `/recipes`'s `MainContent` into the shared `Sidebar` component (above `RecipeList`), so it now surfaces on both `/recipes` and `/recipes/{id}` (`Sidebar` is already shared between those two pages).
- Save button relabeled "Store Recipe" → "Save Recipe" for consistency with the toast copy ("Recipe saved"); edit's "Update Recipe" is unchanged. `pages/dev/design-system.tsx`'s doc comment referencing "Stored!" needs updating to match.
- Bundled in alongside this: Save (and the URL-fetch/photo-upload buttons on `/recipes/new`) gain a real `disabled` + spinner state while their request is in flight, closing a pre-existing double-submit gap — today's `loading` state only tints the button's background color via CSS, with no disabling.
- `components/recipe-form/Form.test.tsx` and `e2e/recipe.spec.ts`, which currently assert on "Store Recipe"/"Stored!" text and no-redirect behavior, will need updating to match the new flow.
- Explicitly out of scope: the error path is unchanged (stays on the form, existing inline `Message` component, no redirect on failure); no change to the URL/photo-import review step that happens before the manual save.
