# Cooking Timeline — Release & Testing Plan

## Pre-release checklist

- [ ] You have access to the TiDB SQL editor (link in CLAUDE.md)
- [ ] You have the Netlify dashboard open and can trigger/watch deploys
- [ ] You have an `OPENAI_API_KEY` set in Netlify's environment variables (needed for AI step extraction fallback)
- [ ] You have at least two existing recipes to test with — ideally one imported from a URL, one created manually

---

## Step 1 — Run the database migration

Apply migration `016_steps.sql` to the production TiDB database **before deploying** (the new API code requires the table to exist).

In the TiDB SQL editor, run:

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

Verify it succeeded:

```sql
DESCRIBE step;
```

Expected: 8 columns including `id`, `recipe_id`, `step_number`, `instruction`, `duration_minutes`, `step_type`, `created_at`, `updated_at`.

---

## Step 2 — Deploy

Merge the branch `claude/document-app-understanding-g95yi` to `main` (or trigger a Netlify deploy from the branch directly). The `build.sh` script runs `npm run package` then `go test ./...` — both must pass before the deploy proceeds.

Watch the Netlify build log for:
- `✔ No ESLint warnings or errors`
- `ok  	recipes/internal/pkg/...` (Go test results)
- A successful Next.js build

---

## Step 3 — Smoke test the API

Copy an `Authorization: Bearer <token>` header from browser dev tools while logged in.

**Health check:**
```bash
curl https://www.bigshop.life/.netlify/functions/recipes/health
# Expected: 200 OK
```

**Steps endpoints — read (should return empty array for a recipe with no steps):**
```bash
curl -H "Authorization: Bearer <token>" \
  https://www.bigshop.life/.netlify/functions/recipes/recipe/<id>/steps
# Expected: 200, body: []
```

**Steps endpoints — write:**
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '[{"instruction":"Chop onion","durationMinutes":5,"stepType":"prep","stepNumber":1}]' \
  https://www.bigshop.life/.netlify/functions/recipes/recipe/<id>/steps
# Expected: 200, body: {"ok":true}
```

**Read back:**
```bash
curl -H "Authorization: Bearer <token>" \
  https://www.bigshop.life/.netlify/functions/recipes/recipe/<id>/steps
# Expected: array with one step
```

**Verify the recipe endpoint includes steps:**
```bash
curl -H "Authorization: Bearer <token>" \
  https://www.bigshop.life/.netlify/functions/recipes/recipe/<id>
# Expected: recipe JSON now has a "steps" array
```

---

## Step 4 — Test step extraction on a new recipe

1. Go to **Recipes → New recipe**
2. Add a recipe from a URL that has a method (e.g. a BBC Good Food or Simply Recipes URL)
3. Fill in the name, confirm the ingredients, and **save**
4. After saving, a **Cooking Steps** section appears below the form
5. Click **Extract with AI**
   - If the source URL is scraped: a green note says "Steps extracted from original source"
   - If AI fallback was used: note says "Steps estimated by AI — please review durations"
   - If neither works: an error message appears with a prompt to add steps manually
6. Review the extracted steps — check that:
   - Step types look sensible (prep/cook/passive/other)
   - Durations are roughly correct (AI estimates may need adjustment)
   - Steps are in the right order
7. Edit any incorrect steps, then click **Save steps**
8. Confirm no error appears after saving

**Also test a manually-entered recipe** (no URL): the AI extraction should still work using the method/instructions text field.

---

## Step 5 — Test editing steps on an existing recipe

1. Open any recipe's edit form
2. Scroll to the **Cooking Steps** section at the bottom
3. Click **Extract with AI** (or **Re-extract** if steps already exist)
4. Drag steps to reorder — confirm the order updates
5. Change a step type and duration
6. Click **Save steps**
7. Reload the page and confirm the steps persisted

---

## Step 6 — Test the Cook page: recipe selection

1. Navigate to **Cook** via the header nav link
2. The sidebar shows all your recipes as a checklist
3. Check two or three recipes
4. The checked recipes appear in the "Recipes to cook" list with colour dots
5. Each has a ✕ to remove it
6. Unchecking moves it back to the checklist
7. **Clear session** removes all and resets

---

## Step 7 — Test the Cook page: lazy step extraction

1. Add a recipe that has **no steps** to the session
2. Click **Plan session →**
3. Instead of showing the overview, the **"Add cooking steps"** view appears
4. The recipe is shown with its colour dot and a StepEditor
5. Click **Extract with AI** and confirm steps load
6. Click **Save steps** — confirm the "Saved" badge appears
7. Click **Continue to overview →** (disabled until saved, unless you skip)
8. Alternatively: click **Skip — proceed without steps** to bypass

---

## Step 8 — Test the Cook page: session overview

1. Add two or three recipes that **have steps** to the session
2. Click **Plan session →** (goes directly to overview)
3. Confirm the vertical track view renders:
   - One row per recipe, with a colour-coded label
   - Checkpoint dots connected by vertical lines
   - Passive steps shown with a hollow dot
   - Duration labels on cook and passive steps only
   - All recipes fully opaque at this point (not yet active)
4. Click **Start Cooking**

---

## Step 9 — Test the Cook page: active cooking mode

1. After clicking **Start Cooking**, the `NextAction` card appears at the bottom of the screen
2. Confirm the first step's instruction is shown
3. For a **cook** step:
   - A green progress bar starts filling immediately
   - The timer shows `0s / N min` and counts up
   - When it passes the expected duration, the bar turns amber and shows `+Xm Ys over`
4. For a **passive** step:
   - The card has a yellow background
   - The countdown shows `N min left` and decrements
   - When it reaches 0 it shows `Ready!`
5. Click **Done** — the card advances to the next step
6. In the SessionOverview (visible behind/above the card), the completed step's dot fills in
7. The active recipe track is fully opaque; others are dimmed to ~30%
8. Click **Overview** link in the card to dismiss the card and see the full track view
9. Continue through all steps until you see the "All done!" finished state
10. Click **Back to overview** from the finished card

---

## Step 10 — Test combined action cards

Add two recipes where early steps are the same verb type (e.g. both start with chopping). After clicking Start Cooking:

- The NextAction card should show a **"Combined action"** heading
- Both recipe names appear as tags above their respective instructions
- A single Done button advances past both

---

## Step 11 — Test session persistence

1. Start a cooking session and advance a few steps
2. Close the browser tab and reopen the Cook page
3. Confirm the session resumes at the same step index
4. Confirm the recipe selection is preserved in the sidebar

---

## Rollback plan

**If the migration needs to be reversed:**
```sql
DROP TABLE IF EXISTS step;
```
The `step` table has no dependents so this is safe.

**If the API deployment needs to be rolled back:**
Redeploy the previous Netlify build from the Netlify dashboard → Deploys → select previous build → Publish deploy.

**Frontend-only issues:**
The cook page is entirely new (`/cook`) and the step editor is an additive section on the recipe form. Neither change removes or alters existing functionality — rolling back the deploy is the only action needed.
