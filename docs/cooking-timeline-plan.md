# Cooking Timeline — Implementation Plan

Each chunk is independently reviewable and shippable. Dependencies are listed explicitly. Chunks with no listed dependencies can be started immediately and worked in parallel.

---

## Chunk 1 — DB migration + Go step model

**What:** The `step` table and all Go-side plumbing for it. Everything else in the backend depends on this.

**Delivers:** Steps can be stored, fetched, and saved per recipe. Steps are included in existing recipe responses.

**Dependencies:** None

**Work:**
- `migrations/016_steps.sql` — create `step` table
- `common/types.go` — add `Step` struct; add `Steps []Step` to `Recipe`
- `service/recipe.go` — extend `GetRecipeByID` and `GetRecipeBySlug` to LEFT JOIN and scan steps; add `GetStepsByRecipeID`, `SaveSteps` (replace-all)
- `app/app.go` — register two new routes
- `app/steps.go` — new handler file: `getStepsHandler`, `saveStepsHandler`
- Go tests for both handlers

**Key files:**
```
migrations/016_steps.sql
netlify-functions/recipes/internal/pkg/common/types.go
netlify-functions/recipes/internal/pkg/service/recipe.go
netlify-functions/recipes/internal/pkg/app/app.go
netlify-functions/recipes/internal/pkg/app/steps.go
```

---

## Chunk 2 — Extraction utility functions

**What:** Shared pure utility functions used by both the scraper path and as helpers in the AI extraction path. No API route yet — just the building blocks.

**Delivers:** `parseDuration` and `inferStepType` utilities, tested and usable by any extractor.

**Dependencies:** None

**Work:**
- `pages/api/third-parties/utils.js` — add `parseDuration(iso8601String) → number|null` (handles `PT5M`, `PT1H30M`, etc.)
- `pages/api/third-parties/utils.js` — add `inferStepType(instruction) → 'prep'|'cook'|'passive'|'other'` (keyword heuristic matching the verb table in the spec)
- Unit tests for both functions covering edge cases (null input, hours+minutes, ambiguous instructions)

**Key files:**
```
pages/api/third-parties/utils.js
```

---

## Chunk 3 — Default scraper: schema.org JSON-LD step extraction

**What:** Add `getSteps(document)` to the default scraper. This is the primary extraction path and will work for the majority of recipe sites without any site-specific code.

**Delivers:** Any recipe with a `remote_url` can have steps extracted from its original source page, with timing data from `performTime` fields.

**Dependencies:** Chunk 2

**Work:**
- `pages/api/third-parties/default.js` — add `getSteps(document)` implementing the JSON-LD parsing logic from the spec (query `script[type="application/ld+json"]`, find `@type: Recipe`, map `recipeInstructions` using `parseDuration` and `inferStepType`)
- Manual test against 2–3 real URLs to validate coverage before writing automated tests
- Note: site-specific scrapers inherit this via the default; they only need their own `getSteps` if their JSON-LD is absent or wrong

**Key files:**
```
pages/api/third-parties/default.js
pages/api/third-parties/utils.js
```

---

## Chunk 4 — Site-specific scraper step extraction

**What:** Add `getSteps` overrides to named scrapers where JSON-LD is absent or unreliable. Most sites won't need this — only those confirmed to fail the default.

**Delivers:** Complete coverage across all supported domains.

**Dependencies:** Chunk 3

**Work:**
- For each scraper in `pages/api/third-parties/`: fetch a real recipe page, check whether the default JSON-LD path returns good steps
- Only add a custom `getSteps` where the default fails — implement DOM-based step extraction for that site
- Expected: most scrapers need no change; 1–2 may need custom `getSteps`
- Update `index.js` hostnameMap comments to note which sites use default vs. custom step extraction

**Key files:**
```
pages/api/third-parties/bbc-good-food.js
pages/api/third-parties/serious-eats.js
pages/api/third-parties/simply-recipes.js
pages/api/third-parties/epicurious.js
pages/api/third-parties/delish.js
pages/api/third-parties/great-british-chefs.js
```

---

## Chunk 5 — `/api/recipe-steps/extract` API route

**What:** The Next.js API route that orchestrates the full extraction pipeline: scraper → AI fallback.

**Delivers:** A single endpoint that accepts `{ recipeId, remoteUrl, method }` and returns structured steps with their source (`"scraper"` | `"ai"` | `"none"`).

**Dependencies:** Chunks 3, 4

**Work:**
- `pages/api/recipe-steps/extract.js` — new route implementing the priority chain:
  1. If `remoteUrl`: fetch page, run appropriate scraper's `getSteps`, return if non-empty
  2. Else if `method`: call GPT-3.5-turbo with the extraction prompt from the spec
  3. Return `{ steps, source }`
- GPT prompt as per spec (split simultaneous actions, classify step types, return JSON only)
- Error handling: network failure on remote URL fetch falls through to AI; OpenAI failure returns `source: "none"`

**Key files:**
```
pages/api/recipe-steps/extract.js
```

---

## Chunk 6 — StepEditor component

**What:** The reusable editable step list UI component. Used in two places: the recipe form (Chunk 7) and the cook session resolution flow (Chunk 11).

**Delivers:** A standalone component that renders an editable list of steps and can trigger extraction. No page integration yet.

**Dependencies:** None (can be built against mock data)

**Work:**
- `components/cook/StepEditor/index.js` — editable step list:
  - Per-step row: instruction textarea, duration number input (minutes), step type `<select>` (prep/cook/passive/other)
  - Drag-to-reorder (use native HTML5 drag or a minimal library)
  - Add step / remove step buttons
  - "Extract with AI" button that calls `/api/recipe-steps/extract` and populates the list
  - "Re-extract" button reruns extraction and merges/replaces results
  - Loading and error states
- `components/cook/StepEditor/StepEditor.module.css`

**Key files:**
```
components/cook/StepEditor/index.js
components/cook/StepEditor/StepEditor.module.css
```

---

## Chunk 7 — Recipe form: step extraction at import time

**What:** Wire StepEditor into the existing recipe creation flow so steps are extracted and confirmed when a recipe is first imported or created.

**Delivers:** Every new recipe saved through the app will have structured steps from day one.

**Dependencies:** Chunks 1, 5, 6

**Work:**
- `pages/recipes/new.js` — after the main recipe form is submitted and saved, show StepEditor pre-populated by calling `/api/recipe-steps/extract` with the saved recipe's URL/method
- `components/recipe-form/Form.js` — add StepEditor as the final section; visible after recipe data is present
- On confirmation, call `POST /recipe/{id}/steps` with the reviewed steps
- Handle the case where extraction yields nothing — allow the user to skip step entry or enter manually
- Existing edit flow (`PUT /recipe`): show StepEditor if recipe has no steps yet; skip if steps already exist

**Key files:**
```
pages/recipes/new.js
components/recipe-form/Form.js
```

---

## Chunk 8 — Batching engine

**What:** The core algorithm that takes all recipes' steps and produces the optimal interleaved cooking sequence. Pure function, no UI, fully unit-testable.

**Delivers:** `scheduleCookingSession(recipes) → ActionItem[]` — the engine that powers the entire active cooking experience.

**Dependencies:** None

**Work:**
- `components/cook/batching.js` — implement the constrained topological sort:
  - Maintain per-recipe step pointer (starts at 0 for each recipe)
  - On each iteration: collect all currently unblocked steps (next step of each recipe where prior step is done or passive)
  - Apply batching heuristic: prefer steps sharing verb group with last scheduled step
  - When a passive step is reached: schedule it, immediately continue scheduling other recipes rather than blocking
  - When verb group matches across multiple unblocked steps: schedule them all consecutively
  - Merge adjacent same-verb-group steps from different recipes into combined `ActionItem`s
  - Return ordered `ActionItem[]`
- `components/cook/verbGroups.js` — the keyword → verb group map (extracted into its own file for easy extension)
- Unit tests covering:
  - Single recipe (passthrough)
  - Two recipes with matching prep steps (batched)
  - Passive step pivot
  - Combined action card merging
  - Recipes with null-duration steps

**Key files:**
```
components/cook/batching.js
components/cook/verbGroups.js
```

---

## Chunk 9 — Cook page scaffold + recipe selector + localStorage

**What:** The `pages/cook.js` page shell, the recipe selection view, and the localStorage session management layer. This sets up the three-view state machine and the "skeleton" of the cook feature.

**Delivers:** Users can navigate to /cook, select recipes, and have that selection persist across reloads. No timeline or active mode yet.

**Dependencies:** Chunk 1 (for steps in recipe data)

**Work:**
- `pages/cook.js` — three-view state machine: `'select' | 'overview' | 'active'`; reads/writes `cookSession` from localStorage on mount
- `hooks/use-cook-session.js` — custom hook encapsulating all localStorage read/write logic for the cook session shape (recipeIds, scheduledSequence, activeStepIndex, stepStartedAt, passiveTimers, actualDurations, startedAt)
- Recipe selector view: reuse `components/shopping-list/Recipes` or extract a generic recipe picker
- "Start planning" button transitions to `overview` (Chunk 10)
- Session rehydration: on mount, if localStorage has a session, restore state and go directly to the appropriate view
- Navigation: add "Cook" link to `components/layout/` header

**Key files:**
```
pages/cook.js
hooks/use-cook-session.js
components/layout/index.js  (nav link)
```

---

## Chunk 10 — Session overview: vertical track view

**What:** The `SessionOverview` component — the visual centrepiece of the feature. Vertical colour-coded recipe tracks with checkpoint dots and step labels.

**Delivers:** A clear, at-a-glance view of all recipes and their steps. Time indicators on cook/passive steps. No interactivity yet beyond the static display.

**Dependencies:** Chunks 8, 9

**Work:**
- `components/cook/SessionOverview/index.js`:
  - Colour palette assignment (fixed accessible set, assigned per recipe index)
  - N vertical lines side-by-side
  - Checkpoint dots per step: filled (prep/cook/other) vs. hollow (passive)
  - Step labels with instruction text to the right of each dot
  - Active recipe: full opacity; others: 30%
  - Completed steps: filled dot, strikethrough label
  - Duration label on `cook` and `passive` steps: `~8 min` (static display, no timer yet — that's Chunk 11)
  - Batching indicators: subtle horizontal connector between dots that will be merged into a combined action
- `components/cook/SessionOverview/SessionOverview.module.css`
- "Start Cooking" button transitions to active view (wired in Chunk 11)

**Key files:**
```
components/cook/SessionOverview/index.js
components/cook/SessionOverview/SessionOverview.module.css
```

---

## Chunk 11 — Active cooking mode + timers

**What:** The `NextAction` card and all live timing behaviour. This completes the active cooking experience.

**Delivers:** Full working cook mode: step-by-step guidance driven by the batching engine, live elapsed/countdown timers, over-time amber states, passive auto-advance, actual duration recording.

**Dependencies:** Chunks 8, 9, 10

**Work:**
- `components/cook/NextAction/index.js`:
  - Anchored bottom card showing current `ActionItem` from the scheduled sequence
  - Recipe colour chip + name
  - Combined action card rendering ("also for Curry, Tagine" chips)
  - "Done" button: marks step(s) complete, records actual duration, advances `activeStepIndex`, recalculates if batching changes
  - Elapsed timer for `cook` steps: counts up using `stepStartedAt` timestamp; amber + overage display when exceeded
  - Passive step state: countdown from `passiveTimers` timestamp; auto-advances on expiry using `use-interval`
  - Brief dismissible "Took N min longer/shorter" note on Done if drift is significant (>25%)
- Wire `NextAction` into `pages/cook.js` active view
- Wire `SessionOverview` progress updates: as `activeStepIndex` advances, mark dots complete and update active recipe opacity
- Live timer for `cook` step on the track label (`5 / 8 min`, amber when over)
- Live countdown pill on running passive steps in the track
- `components/cook/NextAction/NextAction.module.css`

**Key files:**
```
components/cook/NextAction/index.js
components/cook/NextAction/NextAction.module.css
pages/cook.js
```

---

## Chunk 12 — Lazy extraction for existing recipes

**What:** When a recipe with no steps is added to the cook session, trigger extraction inline rather than blocking the user upfront.

**Delivers:** The cook feature works with the existing recipe library without any manual work first. Steps get populated as recipes are used.

**Dependencies:** Chunks 5, 6, 9

**Work:**
- In `pages/cook.js` / `use-cook-session.js`: when a recipe is added to the session that has no steps, call `/api/recipe-steps/extract` automatically
- Show a "Extracting steps…" state on that recipe's card in the selector
- Once extraction completes, show the StepEditor for user review before allowing progression to the overview
- Save confirmed steps via `POST /recipe/{id}/steps`
- If extraction fails or user skips: allow the recipe into the session with a "No steps" warning state visible on its track; it still participates in the session but contributes nothing to the batching sequence

**Key files:**
```
pages/cook.js
hooks/use-cook-session.js
```

---

## Chunk 13 — Data backfill (deferred)

**What:** One-time script to retroactively populate steps for all existing recipes. Deferred until the extraction pipeline has been validated through normal use in Chunks 7 and 12.

**Delivers:** All existing recipes have steps without users having to trigger it themselves.

**Dependencies:** Chunks 5, 7, 12 (validate pipeline quality first)

**Work:**
- Node script (or Go equivalent): iterate all recipes in DB, skip those with existing steps
- For recipes with `remote_url`: call extraction pipeline
- For recipes with only `method`: call AI extraction in rate-limited batches
- Dry-run mode that logs what would be written without persisting
- Human spot-check before running in write mode

**Key files:**
```
scripts/backfill-steps.js  (new)
```

---

## Dependency Graph

```
                    ┌─────────────────┐
                    │  Chunk 1        │
                    │  DB + Go model  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                  │
   ┌──────────▼──────┐       │       ┌──────────▼────────┐
   │  Chunk 2        │       │       │  Chunk 7           │
   │  Util functions │       │       │  Recipe form       │◄──────────┐
   └──────────┬──────┘       │       └────────────────────┘           │
              │              │                                         │
   ┌──────────▼──────┐       │       ┌──────────────────┐             │
   │  Chunk 3        │       │       │  Chunk 5          │             │
   │  Default scraper│       │       │  Extract API      │─────────────┘
   └──────────┬──────┘       │       └────────┬─────────┘
              │              │                │
   ┌──────────▼──────┐       │       ┌────────▼─────────┐
   │  Chunk 4        │       │       │  Chunk 6          │
   │  Site scrapers  │───────┼──────►│  StepEditor       │
   └─────────────────┘       │       └──────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
   ┌──────────▼──────┐       │   ┌──────────▼──────┐
   │  Chunk 8        │       │   │  Chunk 9         │
   │  Batching engine│       │   │  Page + session  │
   └──────────┬──────┘       │   └──────────┬───────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │  Chunk 10       │
                    │  Track view     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Chunk 11       │
                    │  Active mode    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Chunk 12       │
                    │  Lazy extract   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Chunk 13       │
                    │  Backfill       │
                    └─────────────────┘
```

---

## Suggested sequencing for a single developer

| Order | Chunk | Rationale |
|-------|-------|-----------|
| 1 | **8** — Batching engine | Pure JS, no dependencies, gets the hardest algorithmic work done first and fully tested before any UI is built around it |
| 2 | **1** — DB + Go model | Unlocks all backend-dependent work |
| 3 | **2** — Extraction utilities | Small, foundational, needed by scrapers and route |
| 4 | **3** — Default scraper | Highest-value extraction path; validates the source-first approach on real URLs |
| 5 | **6** — StepEditor component | Can be built and tested in isolation against mock data |
| 6 | **5** — Extract API route | Wires utilities + scrapers into a callable endpoint |
| 7 | **4** — Site-specific scrapers | Only tackle scrapers confirmed to need custom `getSteps` |
| 8 | **7** — Recipe form integration | First end-to-end: import a recipe and see steps appear |
| 9 | **9** — Cook page + session | Scaffold the feature's page and persistence layer |
| 10 | **10** — Track view | The main visual; static display, no timers yet |
| 11 | **11** — Active mode + timers | Completes the cooking experience |
| 12 | **12** — Lazy extraction | Makes the feature work with existing recipes |
| 13 | **13** — Backfill | Deferred; run after validating pipeline quality |
