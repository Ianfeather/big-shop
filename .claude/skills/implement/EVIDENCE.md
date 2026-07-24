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

`gh pr create` has no image-upload step of its own.

**Do not use a relative markdown image link** (e.g.
`![...](../specs/evidence/unit-normalisation/list-after-regen.png)`) while the
PR is still open. A PR/issue body isn't tied to any specific commit, so
GitHub resolves relative links in it against the repository's **default
branch** (`master`), not the PR's head branch — not the "current file"
resolution rules that apply inside a rendered file like a README. Evidence
committed only on the feature branch doesn't exist on `master` yet, so the
image 404s and shows as a broken link in the rendered PR, even though the
file is genuinely committed and pushed. (Older evidence links elsewhere in
this repo that *do* render only work because those PRs have since merged —
that's not proof the relative-link approach works pre-merge.)

Instead, reference the file via an absolute `raw.githubusercontent.com` URL
pinned to the commit SHA that has the evidence committed:

```markdown
![Shopping list after regeneration](https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/specs/evidence/unit-normalisation/list-after-regen.png)
```

Get the SHA with `git rev-parse HEAD` right after committing the evidence
(and before pushing is fine — push first, then build the URL). Pinning to
the commit rather than the branch name keeps the link stable even if the
branch is later force-pushed or rebased. Verify the URL actually resolves
before relying on it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/<path>"
```

A `200` confirms the image will render; anything else (404 while GitHub
finishes propagating a fresh push, or a wrong path) means fix it before
handing off the PR.
