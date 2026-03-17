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
4. Work even for recipes that have no structured timing data today

### Non-goals (for this iteration)

- Shared/multiplayer cooking sessions
- Timer notifications via push or email
- Automatic ordering of steps across recipes (steps within each recipe remain sequential)
- Integrating with smart kitchen hardware

---

### User Journey

**Entry point**: A new "Cook" link in the navigation alongside List and Recipes.

#### Step 1 — Select recipes
User picks which recipes to cook in this session. Same recipe-selector pattern as the shopping list page.

#### Step 2 — Resolve timing data
For any recipe missing structured steps, the app attempts AI extraction from the existing `method` text. The user sees a preview of the extracted steps with estimated durations and can edit them before proceeding. Recipes with no `method` text at all prompt the user to add steps manually.

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

Passive steps are key to the timeline value: they create windows where the cook can work on another recipe.

---

### The Timing Data Problem

This is the main technical challenge. Today, recipes have a `method` column containing free-text instructions with no structured steps and no explicit timing. Three scenarios to handle:

#### Scenario A: No method text at all
Many recipes were imported with only ingredients. **Solution**: prompt the user to add method steps when they try to add the recipe to a cook session. Offer a simple step-entry UI.

#### Scenario B: Free-text method, no timing
The most common case. **Solution**: AI extraction — send the method text to GPT and ask it to return structured steps with duration estimates. GPT can infer timings from context ("fry until golden" → ~5 min, "roast at 180°C" → look for explicit time in text or estimate from dish type).

The extracted steps are **saved back to the recipe** so re-extraction is never needed again. The user can review and correct before saving.

#### Scenario C: No timing on individual steps
Even after extraction, some steps will have `null` duration (e.g. "season to taste"). **Solution**: these steps are shown without a time block on the timeline and are surfaced as quick pass-through steps in active cooking mode.

---

## Implementation Spec

### Phase 1: Structured Steps Data Model

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
GET  /recipe/{id}/steps       # Fetch steps for a recipe
POST /recipe/{id}/steps       # Save/replace steps for a recipe
```

Steps are also included in `GET /recipe/{id}` and `GET /recipe/{slug}` responses.

#### New Next.js API route: `/api/recipe-steps/extract`

- **Input**: `{ recipeId, method }` (method text passed directly to avoid a round-trip)
- **Calls**: GPT-3.5-turbo with a structured extraction prompt (GPT-4 is overkill here; no vision needed)
- **Output**: Array of `{ stepNumber, instruction, durationMinutes, stepType }`
- **Prompt strategy**: Ask GPT to identify discrete steps, estimate durations from cooking knowledge where the text is vague, and classify by step type. Request JSON output with the schema above.

Example extraction prompt:
```
You are a cooking assistant. Parse the following recipe method into discrete steps.
For each step, estimate a duration in minutes if one can be reasonably inferred.
Classify each step as one of: prep, cook, passive, other.
Return JSON: [{ stepNumber, instruction, durationMinutes, stepType }]
Respond only with the JSON array, no explanation.

Method:
{{method}}
```

---

### Phase 2: Cook Sessions

#### New migration: `017_cook_sessions.sql`

```sql
CREATE TABLE `cook_session` (
  `id`         int NOT NULL AUTO_INCREMENT,
  `account_id` int NOT NULL,
  `status`     enum('active','completed') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_cook_session_account_id` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`)
);

CREATE TABLE `cook_session_recipe` (
  `id`                   int NOT NULL AUTO_INCREMENT,
  `session_id`           int NOT NULL,
  `recipe_id`            int NOT NULL,
  `start_offset_minutes` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_csr_session_id` FOREIGN KEY (`session_id`) REFERENCES `cook_session` (`id`),
  CONSTRAINT `fk_csr_recipe_id`  FOREIGN KEY (`recipe_id`)  REFERENCES `recipe` (`id`)
);
```

`start_offset_minutes` stores when each recipe should begin relative to the session start. The default suggestion algorithm works backwards from the longest total recipe duration so that all recipes finish at the same time.

#### New Go API routes

```
POST   /cook-session              # Create session { recipeIds: [...] }
GET    /cook-session/{id}         # Get session + all recipes with steps + offsets
PATCH  /cook-session/{id}         # Update offsets (user dragged timeline)
DELETE /cook-session/{id}         # Delete session
```

The `GET /cook-session/{id}` response shape:

```json
{
  "id": 42,
  "status": "active",
  "totalDurationMinutes": 75,
  "recipes": [
    {
      "id": 7,
      "name": "Roast Chicken",
      "startOffsetMinutes": 0,
      "totalDurationMinutes": 75,
      "steps": [
        { "id": 1, "stepNumber": 1, "instruction": "Preheat oven to 200°C", "durationMinutes": 15, "stepType": "passive" },
        { "id": 2, "stepNumber": 2, "instruction": "Season the chicken", "durationMinutes": 5, "stepType": "prep" },
        ...
      ]
    }
  ]
}
```

---

### Phase 3: Frontend

#### New page: `pages/cook.js`

Three internal views managed by local state:

1. **`select`** — Recipe picker (reuse `components/shopping-list/Recipes` selector component)
2. **`timeline`** — Gantt timeline + start offset controls
3. **`active`** — Step-by-step cooking mode

#### New components

**`components/cook/RecipeTimeline/index.js`**
- Renders the Gantt chart
- Props: `recipes` (with steps and offsets)
- Each recipe gets a swimlane; each step a coloured block sized proportionally to duration
- Steps without duration shown as a fixed narrow block with a "?" label
- Horizontal axis label: minutes from 0 to `totalDurationMinutes`

**`components/cook/ActiveCooking/index.js`**
- Shows all currently-active steps across all recipes in a card-per-recipe layout
- Each card shows: recipe name, current step instruction, countdown timer (if timed)
- "Mark done" button on each card advances that recipe to its next step
- Background timer for passive steps shows a pill with remaining time

**`components/cook/StepEditor/index.js`**
- Used in the resolution flow (Phase 1, Step 2 of user journey)
- Renders an editable list of steps with instruction text, duration input, and step type dropdown
- "Extract with AI" button triggers `/api/recipe-steps/extract` and populates the list
- Changes are saved to the recipe via `POST /recipe/{id}/steps` before proceeding to timeline

#### Start offset suggestion algorithm (client-side)

```
totalDuration(recipe) = sum of durationMinutes for all steps (nulls treated as 0)
maxDuration = max totalDuration across all recipes
offset(recipe) = maxDuration - totalDuration(recipe)
```

This means the longest recipe starts at t=0 and shorter recipes start later so they all finish together. Users can override by dragging swimlanes.

---

### Navigation update

Add a "Cook" link to `components/layout/` header alongside the existing List and Recipes links.

---

### Data migration for existing recipes

No automatic backfill needed. Steps are populated lazily:
- When a user adds a recipe to a cook session and it has no steps, the extraction flow is triggered
- Extracted steps are saved and reused from then on

This avoids running a bulk expensive AI operation across all recipes upfront, and means the data model fills up organically through actual use.

---

## Open Questions

1. **Parallel steps within a recipe**: Some recipes have steps that can happen in parallel (e.g. "while the onions fry, chop the garlic"). The current model treats all steps within a recipe as sequential. Should we support parallel steps in a future iteration, or is the sequential model good enough for most cases?

2. **Session persistence**: Should an in-progress cook session survive a page reload? The current shopping list is persisted to the DB; same approach makes sense here but adds complexity. Could defer to Phase 2 and keep Phase 1 client-only.

3. **Step extraction quality**: GPT-3.5-turbo should be sufficient but timing estimates for unusual dishes may be inaccurate. Is it worth adding a "report bad extraction" path so users can flag poor results?

4. **Recipe form integration**: Should the step editor be exposed in the normal recipe edit flow (so users can add steps to a recipe without going through cook mode)? Probably yes for completeness, but it could be Phase 2.
