# Cooking Timeline Feature Spec

## Overview

Big Shop currently handles the planning and shopping phases of cooking. This feature extends it into the cooking phase itself, specifically for batch cooking sessions or complex dinners where multiple recipes are cooked simultaneously.

Users will be able to select a set of recipes to cook together and see a unified, slick view of all cooking steps across all recipes — with intelligent cross-recipe step batching to minimise kitchen context switching.

---

## Product Spec

### Problem

When cooking multiple recipes at once, coordination is difficult:
- Recipes are designed to be read individually, in sequence
- There's no view across recipes showing what can happen in parallel
- Passive steps (oven, resting) create idle time that could be used for other recipes
- Without a combined view, you end up chopping for one recipe, starting to cook, then realising you need to chop for the next one too — wasted effort and dirty board

### Goals

1. Show a clear, colour-coded parallel view of all recipes and their steps
2. Intelligently batch similar operations across recipes to minimise context switching
3. Guide users step-by-step through the combined cooking session
4. Populate timing data from original recipe sources wherever possible

### Non-goals (for this iteration)

- Shared/multiplayer cooking sessions
- Timer notifications via push or email
- Integrating with smart kitchen hardware

---

### User Journey

**Entry point**: A new "Cook" link in the navigation alongside List and Recipes.

#### Step 1 — Select recipes
User picks which recipes to cook in this session. Same recipe-selector pattern as the shopping list page. The current session is saved to `localStorage` so it survives page reloads.

#### Step 2 — Resolve timing data
Shown only for recipes that don't yet have structured steps. The app attempts extraction automatically (see data strategy below). The user sees a preview of the extracted steps with estimated durations and can edit, reorder, or add steps before proceeding. Recipes where all extraction methods fail prompt the user to add steps manually.

#### Step 3 — Session overview (vertical track view)
A parallel view of all recipes as vertical tracks:
- One vertical coloured line per recipe, displayed side-by-side
- Checkpoint dots mark each step on the line; step instructions appear as labels beside each dot
- Recipe name and colour shown at the top of each track
- The *active* recipe track (the one currently needing attention) is fully opaque; others are dimmed to ~30% opacity
- Passive steps are visually distinct (hollow dot, muted label) to signal "this is running, you don't need to be here"

This view gives the cook a bird's-eye picture of the whole session before starting and is the reference view during cooking.

#### Step 4 — Active cooking mode
User taps "Start Cooking". The vertical track view remains but a **"Next action" card** appears at the bottom of the screen:
- Shows the immediate next step to take, with which recipe it belongs to (colour-matched chip)
- Countdown timer for timed steps
- "Done" button advances that step and recalculates the next action
- The card automatically accounts for batching — if the next logical action is the same operation across two recipes, the card says so: *"Chop onions for Bolognese and Curry"*
- When a passive step starts (oven on, meat resting), the card switches focus to another recipe

---

### Step Types

| Type | Description | Visual |
|------|-------------|--------|
| `prep` | Active preparation (chopping, measuring, mixing) | Filled dot, yellow label |
| `cook` | Active cooking requiring attention (frying, stirring) | Filled dot, orange label |
| `passive` | Unattended time (oven, resting, marinating, simmering) | Hollow dot, muted label, countdown pill |
| `other` | Anything that doesn't fit the above | Filled dot, grey label |

Passive steps are the key value driver: they create windows where the cook can work on another recipe. The visual distinction makes this obvious at a glance.

---

### The Timing Data Problem

Today, recipes have a `method` column containing free-text instructions with no structured steps and no explicit timing. The primary strategy is to go back to the **original source** rather than inferring from the text — most recipe sites publish `schema.org/Recipe` JSON-LD with structured steps including ISO 8601 timing (`performTime`). AI extraction is the fallback for recipes without a source URL or from unsupported sites.

#### Extraction priority chain

1. **schema.org JSON-LD** from the recipe's `remote_url` — parse `recipeInstructions` (array of `HowToStep`) for `text` and `performTime`/`totalTime`. This is the highest-fidelity source and works on the majority of recipe sites without any site-specific scraping logic.

2. **Site-specific scraper** `getSteps` method — for sites where JSON-LD is absent or incomplete, add a `getSteps(document)` method to each existing scraper (mirroring the existing `getList` pattern).

3. **AI extraction** from existing `method` text — send the method text to GPT-3.5-turbo to parse into discrete steps with estimated durations. Used when there is no `remote_url`, the URL is unreachable, or the URL belongs to an unsupported domain.

4. **Manual entry** — the user adds steps themselves via the step editor in the recipe form.

#### Handling implicit parallel steps

During extraction, steps that describe simultaneous actions ("while the onions fry, chop the garlic") are broken into separate sequential steps. The AI prompt explicitly instructs this; JSON-LD instructions are usually already separated.

#### Extraction timing

Step extraction is triggered at **recipe import time** — when a recipe is first saved via the new recipe form or a third-party URL import. The `StepEditor` component is shown as the final step of the recipe creation flow, pre-populated with extracted steps. The user confirms or edits before saving.

For existing recipes without steps, extraction runs lazily when the recipe is first added to a cook session.

Steps are **saved to the recipe** once confirmed so extraction never runs twice.

---

### Step Batching

The batching system is what makes the active cooking experience genuinely useful. Rather than walking through recipe A entirely and then recipe B, it produces a single optimised sequence of actions across all recipes — grouping similar operations to minimise context switching.

#### The problem it solves

Given three recipes each starting with knife work, the naïve approach produces:
```
Cut onion (A) → Fry onion (A) → Cut onion (B) → Fry onion (B) → Cut garlic (C) → ...
```

The batched approach:
```
Cut onion (A + B) → Cut garlic (C) → Fry onion (A) → Fry onion (B) → ...
```
Board out once, all cuts done together.

#### Algorithm

This is a constrained topological sort with a grouping heuristic.

**Rules:**
1. **Ordering constraint**: a step can only be scheduled after all previous steps in its recipe are complete (recipe step order is never violated)
2. **Passive step pivot**: when the scheduled step is `passive`, immediately add it to the queue and look for work in other recipes rather than waiting
3. **Batching heuristic**: when choosing the next step from the set of currently unblocked steps, prefer steps that share an operation verb with the most recently completed step

**Operation verb extraction** — a lightweight keyword match (no AI needed):

| Verb group | Keywords |
|-----------|---------|
| `cut` | chop, dice, slice, mince, grate, cut, julienne, peel |
| `measure` | measure, weigh, portion |
| `mix` | mix, stir, whisk, combine, fold |
| `heat` | preheat, boil water, bring to boil, heat oil |
| `fry` | fry, sauté, sweat, brown |
| `bake` | bake, roast, grill |

**Worked example:**

```
Recipe A: cut onion → fry onion → simmer 20m (passive)
Recipe B: cut onion → cut carrot → fry carrot → roast 40m (passive)

Unblocked at start: [A.cut onion, B.cut onion]

1. Schedule A.cut onion  → verb: "cut"
   Unblocked: [B.cut onion, A.fry onion]  — prefer cut → schedule B.cut onion
2. Schedule B.cut onion  → verb: "cut"
   Unblocked: [A.fry onion, B.cut carrot] — prefer cut → schedule B.cut carrot
3. Schedule B.cut carrot → verb: "cut"
   Unblocked: [A.fry onion, B.fry carrot] — no more cuts; prefer fry (either) → schedule A.fry onion
4. Schedule A.fry onion  → verb: "fry"
   Unblocked: [B.fry carrot, A.simmer(passive)] — passive: add A.simmer, pivot; prefer fry → schedule B.fry carrot
5. Schedule A.simmer (passive, 20m countdown starts)
6. Schedule B.fry carrot → verb: "fry"
   Unblocked: [B.roast(passive)] — passive: add B.roast
7. Schedule B.roast (passive, 40m countdown starts)
   → Only passive steps running, show timers for both

Final sequence: cut onion (A+B combined card), cut carrot (B), fry onion (A), simmer 20m (A — passive),
                fry carrot (B), roast 40m (B — passive), [wait / manage timers]
```

Steps A.1 and B.1 (both "cut onion") are presented as a **combined action card** in the UI: *"Chop the onions — for Bolognese and Curry"*.

#### Combined action cards

When two or more steps from different recipes share the same verb group and are adjacent in the scheduled sequence:
- Merge them into a single card in the "Next action" panel
- Show the instruction from the first recipe as the primary text
- List the other recipes as chips below: "also for Curry, Tagine"
- Duration shown is the max of the merged steps
- "Done" marks all of them complete simultaneously

---

## Implementation Spec

### Phase 1: Structured Steps Data Model

The foundation. Everything else builds on this.

#### New migration: `016_steps.sql`

```sql
CREATE TABLE `step` (
  `id`               int NOT NULL AUTO_INCREMENT,
  `recipe_id`        int NOT NULL,
  `step_number`      int NOT NULL,
  `instruction`      text NOT NULL,
  `duration_minutes` int,
  `step_type`        enum('prep','cook','passive','other') NOT NULL DEFAULT 'other',
  `created_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_step_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`)
);

CREATE INDEX idx_step_recipe_id ON step (recipe_id);
```

#### Go type additions (`common/types.go`)

```go
type Step struct {
    ID              int    `json:"id"`
    RecipeID        int    `json:"recipeId"`
    StepNumber      int    `json:"stepNumber"`
    Instruction     string `json:"instruction"`
    DurationMinutes *int   `json:"durationMinutes"` // nullable
    StepType        string `json:"stepType"`
}
```

Add `Steps []Step` to the `Recipe` struct.

#### New Go API routes

```
GET  /recipe/{id}/steps    # Fetch steps for a recipe
POST /recipe/{id}/steps    # Save/replace all steps for a recipe
```

Steps are also included in existing `GET /recipe/{id}` and `GET /recipe/{slug}` responses so the client always has them without an extra round-trip.

---

### Phase 2: Step Extraction Pipeline

Runs server-side as a Next.js API route called at import time and lazily on first cook session use.

#### Extend third-party scrapers

Add a `getSteps(document)` method to each scraper in `pages/api/third-parties/`. Returns:

```js
[{ instruction: string, durationMinutes: number|null, stepType: string }]
```

**Default scraper enhancement** — parse `schema.org/Recipe` JSON-LD first:

```js
getSteps(document) {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const data = JSON.parse(script.innerText);
    const recipe = Array.isArray(data) ? data.find(d => d['@type'] === 'Recipe') : data;
    if (recipe?.recipeInstructions) {
      return recipe.recipeInstructions.map((step, i) => ({
        instruction: step.text || step,
        durationMinutes: parseDuration(step.performTime || step.totalTime),
        stepType: inferStepType(step.text || step),
      }));
    }
  }
  return null; // site-specific scrapers try their own DOM approach
}
```

`parseDuration` converts ISO 8601 (`PT30M`, `PT1H30M`) to minutes. `inferStepType` applies keyword heuristics (`oven`, `bake`, `roast` → `passive`; `chop`, `dice` → `prep`; etc.).

#### New Next.js API route: `POST /api/recipe-steps/extract`

Input: `{ recipeId, remoteUrl, method }`

Logic:
1. If `remoteUrl` present: fetch page, run scraper `getSteps`, return if non-empty
2. If step 1 yields nothing and `method` present: call GPT-3.5-turbo (prompt below)
3. Return `{ steps: [...], source: "scraper"|"ai"|"none" }`

**AI extraction prompt:**
```
You are a cooking assistant. Parse the following recipe method into discrete cooking steps.

Rules:
- Split any step that describes two simultaneous actions into two separate sequential steps
- Estimate a duration in minutes where you can reasonably do so; use null if uncertain
- Classify each step as: prep (chopping/measuring/mixing), cook (active heat requiring attention),
  passive (oven/resting/marinating — no attention needed), or other
- Return only a JSON array, no explanation

Schema: [{ "stepNumber": 1, "instruction": "...", "durationMinutes": 10, "stepType": "prep" }]

Method:
{{method}}
```

#### Recipe form integration (`components/recipe-form/`)

Add a `StepEditor` sub-component as the final section of the recipe form:
- On new recipe import: auto-calls `/api/recipe-steps/extract` after main recipe data is populated
- Shows loading state, then displays extracted steps for user review and editing
- Editable list: instruction text, duration input, step type dropdown, drag-to-reorder, add/remove
- "Re-extract" button reruns extraction
- Steps submitted alongside recipe form and saved via `POST /recipe/{id}/steps`

---

### Phase 3: Cook Sessions (localStorage)

No DB tables needed. Session stored in `localStorage` key `cookSession`:

```json
{
  "recipeIds": [7, 12, 3],
  "scheduledSequence": [...],
  "activeStepIndex": 4,
  "passiveTimers": { "stepId_22": 1712345678000 },
  "startedAt": null
}
```

`passiveTimers` maps step ID → UTC timestamp when the passive step started (used to compute remaining time on reload). `startedAt` is set when the user taps "Start Cooking".

---

### Phase 4: Frontend Components

#### `components/cook/SessionOverview/index.js`

The vertical track view:
- `N` vertical coloured lines displayed side-by-side, one per recipe
- Recipe name + colour swatch at the top of each track
- Checkpoint dots on each line for each step, with instruction labels to the right
- Active recipe track: full opacity. Others: 30% opacity
- Passive steps: hollow dot, muted label, countdown pill showing remaining minutes
- Completed steps: dot fills in, label gets a strikethrough
- No time axis — this is a qualitative sequence view, not a time chart

Colours are assigned from a fixed accessible palette, consistently assigned per recipe for the session.

#### `components/cook/NextAction/index.js`

The persistent "what to do now" card shown during active cooking:
- Anchored to the bottom of the screen
- Shows the current scheduled step (or combined action card if merged)
- Recipe colour chip and name as context
- Countdown timer for timed steps
- "Done" button — advances the sequence, marks step(s) complete, recalculates next action
- For passive steps: shows a "Running" state with countdown; auto-advances when timer expires

#### `components/cook/StepEditor/index.js`

Editable step list used in the recipe form and in the session resolution flow:
- Drag-to-reorder
- Per-step: instruction textarea, duration input (minutes), step type select
- "Extract with AI" / "Re-extract" button
- "Add step" button appends blank step

#### Batching engine: `components/cook/batching.js`

Pure function, no side effects, fully testable:

```js
// Input: array of recipes, each with ordered steps array
// Output: scheduled sequence of action items
scheduleCookingSession(recipes) → ActionItem[]

// ActionItem shape:
{
  type: 'action' | 'passive',
  steps: [{ recipeId, stepId, instruction, durationMinutes, stepType }], // array for merged actions
  mergedLabel: string | null,  // e.g. "also for Curry, Tagine"
  durationMinutes: number | null,
}
```

The batching engine is the only place operation verb extraction lives — no duplication.

---

### Navigation update

Add a "Cook" link to `components/layout/` header alongside the existing List and Recipes links.

---

### Data cleanup task (separate backlog item)

Once the extraction pipeline is proven on new imports, run a one-time backfill for existing recipes:
1. For each recipe with a `remote_url` and no steps: call `/api/recipe-steps/extract` server-side
2. For recipes with no URL but with a `method`: queue AI extraction in batches within OpenAI rate limits
3. Review results before persisting

Deferred deliberately — validate quality through normal use before investing in bulk backfill.

---

## Decisions Log

| # | Question | Decision |
|---|----------|----------|
| 1 | Parallel steps within a recipe | Break into separate sequential steps during extraction; don't model parallelism within a recipe |
| 2 | Session persistence | `localStorage` — no DB tables needed; rehydrate on page load |
| 3 | Step extraction quality | Source-first: schema.org JSON-LD from `remote_url`; AI as fallback; bulk backfill deferred |
| 4 | Recipe form integration | Step extraction runs at import time as the final step of the recipe creation flow |
| 5 | Timeline visualisation | Vertical colour-matched tracks per recipe, not a Gantt chart; active recipe fully opaque, others dimmed |
| 6 | Step batching | Constrained topological sort with operation verb grouping heuristic; passive steps trigger pivot to other recipes; adjacent same-verb steps merged into combined action cards |
