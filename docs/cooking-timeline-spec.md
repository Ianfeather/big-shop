# Cooking Timeline Feature Spec

## Overview

Big Shop currently handles the planning and shopping phases of cooking. This feature extends it into the cooking phase itself, specifically for batch cooking sessions or complex dinners where multiple recipes are cooked simultaneously.

Users will be able to select a set of recipes to cook together and see a unified timeline — a parallel view of every cooking step across all recipes, so they can coordinate their time in the kitchen effectively.

---

## Product Spec

### Problem

When cooking multiple recipes at once, coordination is difficult:
- Recipes are designed to be read individually, in sequence
- There's no view across recipes showing what can happen in parallel
- Passive steps (oven, resting) create idle time that could be used for other recipes
- Without a combined timeline, it's easy to have everything ready at different times

### Goals

1. Show a parallel cooking timeline across multiple recipes
2. Suggest optimal start offsets so all recipes finish at the same time
3. Guide users step-by-step through the combined cooking session
4. Populate timing data from original recipe sources wherever possible

### Non-goals (for this iteration)

- Shared/multiplayer cooking sessions
- Timer notifications via push or email
- Automatic cross-recipe step reordering (steps within each recipe remain sequential)
- Integrating with smart kitchen hardware

---

### User Journey

**Entry point**: A new "Cook" link in the navigation alongside List and Recipes.

#### Step 1 — Select recipes
User picks which recipes to cook in this session. Same recipe-selector pattern as the shopping list page. The current session is saved to `localStorage` so it survives page reloads.

#### Step 2 — Resolve timing data
Shown only for recipes that don't yet have structured steps. The app attempts extraction automatically (see data strategy below). The user sees a preview of the extracted steps with estimated durations and can edit, reorder, or add steps before proceeding. Recipes where all extraction methods fail prompt the user to add steps manually.

#### Step 3 — Timeline view
A Gantt-style timeline is generated:
- One horizontal swimlane per recipe
- X-axis is time in minutes from session start
- Each step is a block coloured by type (see step types below)
- The app suggests start offsets per recipe so they all finish around the same time
- Users can drag recipe swimlanes to manually adjust start times

#### Step 4 — Active cooking mode
User taps "Start Cooking". The view switches to step-by-step guidance:
- Shows the current active step(s) across all recipes simultaneously
- Countdown timer for timed steps
- "Done" button advances that recipe to its next step
- Passive steps (oven, resting) run in the background with a visible countdown

---

### Step Types

| Type | Description | Colour |
|------|-------------|--------|
| `prep` | Active preparation (chopping, measuring, mixing) | Yellow |
| `cook` | Active cooking requiring attention (frying, stirring) | Orange |
| `passive` | Unattended time (oven, resting, marinating, simmering) | Green |
| `other` | Anything that doesn't fit the above | Grey |

Passive steps are the key value driver: they create windows where the cook can work on another recipe.

---

### The Timing Data Problem

Today, recipes have a `method` column containing free-text instructions with no structured steps and no explicit timing. The primary strategy is to go back to the **original source** rather than inferring from the text — most recipe sites publish `schema.org/Recipe` JSON-LD with structured steps including ISO 8601 timing (`performTime`). AI extraction is the fallback for recipes without a source URL or from unsupported sites.

#### Extraction priority chain

1. **schema.org JSON-LD** from the recipe's `remote_url` — parse `recipeInstructions` (array of `HowToStep`) for `text` and `performTime`/`totalTime`. This is the highest-fidelity source and works on the majority of recipe sites without any site-specific scraping logic.

2. **Site-specific scraper** `getSteps` method — for sites where JSON-LD is absent or incomplete, add a `getSteps(document)` method to each existing scraper (mirroring the existing `getList` pattern).

3. **AI extraction** from existing `method` text — send the method text to GPT-3.5-turbo to parse into discrete steps with estimated durations. This is used when there is no `remote_url`, the URL is unreachable, or the URL belongs to an unsupported domain.

4. **Manual entry** — the user adds steps themselves via the step editor in the recipe form. Shown when all automated methods produce no results.

#### Handling implicit parallel steps

Some methods describe simultaneous actions: *"while the onions fry, chop the garlic."* During extraction — whether via JSON-LD, scraper, or AI — these should be broken into separate sequential steps. The AI prompt should explicitly instruct this. For JSON-LD / scraper extraction the instructions are usually already separated.

#### Extraction timing

Step extraction is triggered at **recipe import time** — when a recipe is first saved via the new recipe form or via a third-party URL import. The `StepEditor` component is shown as the final step of the recipe creation flow, pre-populated with the extracted steps. The user confirms or edits before saving.

For existing recipes without steps, extraction runs lazily when the recipe is first added to a cook session.

Steps are **saved to the recipe** once confirmed so extraction never runs twice.

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

Add a `getSteps(document)` method to each scraper in `pages/api/third-parties/`. The method returns:

```js
[{ instruction: string, durationMinutes: number|null, stepType: string }]
```

**Default scraper enhancement** — parse `schema.org/Recipe` JSON-LD first:

```js
getSteps(document) {
  // 1. Try schema.org JSON-LD
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
  // 2. Fall back to DOM parsing (site-specific implementations override this)
  return null;
}
```

`parseDuration` converts ISO 8601 (`PT30M`, `PT1H30M`) to minutes. `inferStepType` applies keyword heuristics (`oven`, `bake`, `roast` → `passive`; `chop`, `dice`, `measure` → `prep`; etc.).

Site-specific scrapers only need to implement `getSteps` if their JSON-LD is absent/wrong — most won't need it.

#### New Next.js API route: `POST /api/recipe-steps/extract`

Input:
```json
{ "recipeId": 7, "remoteUrl": "https://...", "method": "..." }
```

Logic:
1. If `remoteUrl` is present: fetch the page, run the appropriate scraper's `getSteps`, return results if non-empty
2. If step 1 yields nothing and `method` is present: call GPT-3.5-turbo with the extraction prompt below
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

Add a `StepEditor` sub-component as the final section of the recipe form, appearing after Method:

- On new recipe import: automatically calls `/api/recipe-steps/extract` with the URL/method after the main recipe data is populated, shows a loading state, then displays results for user review
- Shows an editable step list: instruction text, duration input, step type dropdown, drag handles for reordering, add/remove buttons
- "Re-extract" button reruns extraction
- Steps are submitted alongside the rest of the recipe form data and saved via `POST /recipe/{id}/steps`

---

### Phase 3: Cook Sessions (localStorage)

No new DB tables needed. The cook session is stored in `localStorage` under the key `cookSession` as:

```json
{
  "recipeIds": [7, 12, 3],
  "startOffsets": { "7": 0, "12": 20, "3": 35 },
  "activeSteps": { "7": 2, "12": 0, "3": 1 },
  "startedAt": null
}
```

`startedAt` is `null` until the user taps "Start Cooking", then set to a UTC timestamp. This enables countdown timers to be computed from elapsed time rather than fragile interval state.

The page reads this on mount and rehydrates the session. If recipe data has changed since the session was saved (steps added/edited), the session is merged rather than discarded.

#### New page: `pages/cook.js`

Three internal views managed by local state, persisted to `localStorage`:

1. **`select`** — Recipe picker, reusing `components/shopping-list/Recipes` selector component
2. **`timeline`** — Gantt chart + start offset controls + "Start Cooking" button
3. **`active`** — Step-by-step cooking mode

---

### Phase 4: Frontend Components

#### `components/cook/RecipeTimeline/index.js`

Gantt chart component:
- Props: `recipes` (array with steps and offsets), `totalDuration`, `onOffsetChange`
- One swimlane per recipe, coloured step blocks sized proportionally to duration
- Steps without duration shown as a fixed-width block with a "?" label
- X-axis tick marks at 5 or 10 minute intervals depending on total duration
- Draggable swimlane handles to adjust start offset per recipe

**Start offset suggestion algorithm** (runs when recipes change):
```
totalDuration(recipe) = sum of durationMinutes for all steps (nulls treated as 0)
maxDuration = max totalDuration across all recipes
suggestedOffset(recipe) = maxDuration − totalDuration(recipe)
```
The longest recipe starts at t=0; all others start later so they finish together.

#### `components/cook/ActiveCooking/index.js`

Step-by-step cooking mode:
- Card-per-recipe layout showing the current step for each recipe
- Active steps (`prep`/`cook`): countdown timer if timed, "Mark done" button
- Passive steps: pill showing remaining time, auto-advances when timer reaches zero
- When all steps for a recipe are complete, the card shows a "Done" state
- A global elapsed time indicator in the header

#### `components/cook/StepEditor/index.js`

Editable step list used in both the recipe form (at import time) and in the cook session resolution flow:
- Drag-to-reorder
- Per-step: instruction text area, duration number input (minutes), step type select
- "Extract with AI" / "Re-extract" button
- "Add step" button appends a blank step

---

### Navigation update

Add a "Cook" link to `components/layout/` header alongside the existing List and Recipes links.

---

### Data cleanup task (separate backlog item)

Once the extraction pipeline is proven on new imports, run a one-time backfill for existing recipes:
1. For each recipe with a `remote_url` and no steps: call `/api/recipe-steps/extract` server-side
2. For recipes with no URL but with a `method`: queue AI extraction in batches to stay within OpenAI rate limits
3. Review results before persisting (given volume, a simple admin script with human spot-check is appropriate)

This is deferred deliberately — the quality of the source-first scraping approach should be validated through normal use before investing in a bulk backfill.

---

## Decisions Log

| # | Question | Decision |
|---|----------|----------|
| 1 | Parallel steps within a recipe | Break into separate sequential steps during extraction; don't model parallelism within a recipe |
| 2 | Session persistence | `localStorage` — no DB tables needed; rehydrate on page load |
| 3 | Step extraction quality | Source-first: extract from `remote_url` using schema.org JSON-LD before falling back to AI; bulk backfill is a separate deferred task |
| 4 | Recipe form integration | Yes — step extraction runs at import time as the final step of the recipe creation flow |
