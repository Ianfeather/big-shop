# Evidence

Disclosed reference for `implement`'s step 5. What to gather, where it lives, and how it ends up visible in the PR body.

## What counts as evidence

Pick whichever of these apply — not every spec produces all three, and forcing one that doesn't fit is worse than skipping it:

- **Screenshots** — for any Session that changed a UI-visible surface. Use the `run` skill (or `claude-in-chrome` directly) to drive the actual golden path the spec describes, and capture the state that proves it works — not just a page load. One screenshot per user-visible capability the spec added is the bar, not one per Session.
- **Screen recordings** — when the evidence is a multi-step interaction a still can't show (e.g. a workflow spanning several pages, or a before/after that only reads as motion). Use `claude-in-chrome`'s `gif_creator`. Don't reach for this by default — a screenshot that proves the same thing is cheaper to review.
- **Metadata** — always include, regardless of whether the spec has a visual surface: a summary of test output (what ran, what passed), the list of migration files added/changed, any `follow-ups.md` items opened or resolved during the run, and the final Session checklist from the state file.

A backend-only spec (no UI surface at all) can rely on metadata alone — don't manufacture a screenshot for something with nothing to show.

## Where captured files live

Commit screenshots/recordings to the branch under `specs/evidence/<spec-slug>/` (create it if it doesn't exist). They need to be part of the same branch/commit as the PR, not left uncommitted or stored outside the repo — GitHub only renders a PR body's relative-path images when they resolve against a real file in that branch.

## Embedding in the PR body

`gh pr create` has no image-upload step of its own. Reference the committed files with a relative markdown image link from the repo root, e.g.:

```markdown
![Shopping list after regeneration](../specs/evidence/unit-normalisation/list-after-regen.png)
```

GitHub resolves that against the PR's branch and renders it inline — no separate upload needed as long as the file is genuinely committed on that branch before the PR is opened.
