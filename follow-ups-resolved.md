# Follow-ups (resolved)

Completed items migrated out of [`follow-ups.md`](./follow-ups.md) to keep that
file focused on what's still open. Original numbering preserved for
cross-references between entries (e.g. #9 references #16).

1. ~~CLAUDE.md: stale `pages/api/third-parties/*` doc entry.~~ **Resolved** — CLAUDE.md was split into CLAUDE.md + `technical-architecture.md`; the latter's "Next.js API Routes" table now correctly documents `parse-recipe-url.js`/`parse-recipe-text.js` in place of the deleted per-site scrapers.

2. ~~CLAUDE.md: wrong table name for shopping list history.~~ **Resolved** — `technical-architecture.md`'s "Database Schema" table now correctly names `shopping_list_event` (an append-only event log, not snapshots).

3. ~~`RemoveUserFromAccount` is broken.~~ **Resolved** — `netlify-functions/recipes/internal/pkg/service/account.go`'s `DELETE` now targets `account_user` (was `user_account`, a table that doesn't exist), and uses `db.Exec` instead of `db.Query` (the latter was leaking an unclosed `*sql.Rows` on every call). `DELETE /account/remove` works.

4. ~~`ingredient_department` has no unique constraint on `ingredient_id`.~~ **Resolved** — `migrations/017_ingredient_department_unique.sql` adds `UNIQUE (ingredient_id)`, following the same convention as `016_unit_unique.sql`. A duplicate insert now fails at write time instead of silently fanning out an Ingredient Line via `recipe.go`'s `LEFT JOIN`.

6. ~~Generating the Shopping List resets bought-state on every Ingredient Item.~~ **Resolved** — `createListHandler` now fetches the existing ingredient list before regenerating and carries `is_bought=true` forward for any ingredient name that survives into the new combined list; `AddIngredientListItems` inserts the carried-over value instead of a hardcoded `false`. Extra Items were already, and remain, unaffected.

7. ~~Generate an OpenAPI spec for the Go API.~~ **Resolved** — migrated `internal/pkg/app` from raw `net/http`/`gorilla/mux` handlers to [Huma](https://github.com/danielgtaylor/huma) (`humamux` adapter on the same `mux.Router`, so routing/middleware are unchanged). Each operation's typed Input/Output struct is both the request/response binding *and* the OpenAPI schema source, so the two can't independently drift the way a hand-annotated spec could. Spec is committed at `docs/openapi.yaml`, regenerated via `go run . openapi` (no DB required), with `build.sh` failing the build on drift. Pinned to `huma/v2@v2.35.0` — at the time, the latest version supporting go 1.23; newer releases require go 1.24+. (Go has since been bumped to 1.25 for OpenTelemetry — `specs/observability.md` — so that constraint no longer binds and the pin is now merely inertia, not a requirement.) One route was reshaped: `GET /recipe/{slug:[a-zA-Z-]+}` and `GET /recipe/{id:[0-9]+}` (two mux routes disambiguated by regex) became a single `GET /recipe/{id}` (tries `strconv.Atoi` first, falls back to slug lookup) since gorilla/mux's per-segment regex constraints leak verbatim into Huma's generated path templates. Adopting Huma's schema-derived request validation also surfaced three real, pre-existing gaps between the frontend's actual request payloads and the Go structs used to bind them — fixed as part of this migration since they'd otherwise have newly 422'd in production: `common.Recipe.ID` (POST /recipe sends no `id` for a new Recipe), `common.User.ID`/`Name` (POST /user and /invite send partial bodies), and `common.Ingredient.Department` (the frontend never supplies it — it's resolved server-side from `ingredient_department`). All now `omitempty`. `DELETE /recipe` got its own minimal `{id}` input type rather than widening `common.Recipe` further, since doing that would have made `omitempty` start silently dropping empty `ingredients`/`tags` arrays from `GET /recipe/{id}` responses (breaking `.map()` calls on the frontend for recipes with no ingredients/tags).

8. ~~No frontend testing framework established.~~ **Resolved** — added Vitest + React Testing Library (`vitest.config.js`, `npm run test`/`test:watch`), documented in CLAUDE.md's Testing section. Notable snag: components/hooks in this repo write JSX in plain `.js` files, which neither Vite's default esbuild plugin nor `@vitejs/plugin-react`'s babel pass transform out of the box (both effectively only treat `.jsx`/`.tsx` as JSX) — worked around with a small custom `jsx-in-js` esbuild-transform plugin in `vitest.config.js`. Example tests added at `components/button/index.test.js` and `hooks/use-page-visibility.test.js`. E2e (Playwright) intentionally left for a future follow-up.

9. ~~Convert the frontend to TypeScript, so it can be type-checked.~~ **Resolved** — design decided via a grilling session, recorded in [ADR-0002](./docs/adr/0002-typescript-migration.md); executed as a 4-session sweep (`specs/typescript-migration.md`): tooling/codegen, `hooks/`, `components/`, then `pages/` + `pages/api/*`. API response types are generated from `docs/openapi.yaml` via `openapi-typescript` into `types/api.d.ts` (drift-checked in `build.sh`, same pattern as the spec itself), with friendly named aliases in `types/models.ts`. `lib/recipe-import/*` and `formidable` (no bundled or `@types` type definitions) stay plain `.js`/untyped, given sidecar `.d.ts` declaration files instead of being converted/rewritten. Two real, pre-existing runtime bugs surfaced along the way, not expressible as type-only fixes so fixed as part of the sweep — see item 16 below, and `pages/recipes/[id]/index.tsx`/`edit.tsx` passing a dead `recipes` prop to `RecipeList` (which has never read one — it always fetches its own via `useRecipes()`), removed along with the now-unused hook call.

10. ~~`ShoppingList`'s department sort comparator looks inverted/buggy.~~ **Resolved** — `components/shopping-list/ShoppingList/index.js`'s `sortByDepartment` is now a priority-based comparator (`DEPARTMENT_ORDER = ['meat and fish', 'other', 'vegetables']`, unknown/missing departments sort last of all) instead of the old ad-hoc branching, which returned the wrong sign for the vegetables case and `undefined` (silently treated as `0`) for several department pairings. Vegetables now sort last (non-perishables bought first, veg last so it doesn't get crushed sitting in the trolley), and every pairing produces a defined result, so the ordering is a proper total order. The existing "items sharing a department stay adjacent" invariant in `index.test.js` still passes.

11. ~~Open: `GET /recipe/{id}` returns 200 with an all-zero-value body instead of 404 for a nonexistent ID or slug.~~ **Resolved** — `service.GetRecipeByID`/`GetRecipeBySlug` (`netlify-functions/recipes/internal/pkg/service/recipe.go`) now check `recipe.ID == 0` after the `results.Next()` loop and return `sql.ErrNoRows` in that case, so the handler's existing `err == sql.ErrNoRows` → 404 branch (`netlify-functions/recipes/internal/pkg/app/recipe.go`) actually fires instead of being dead code. Also dropped a couple of leftover debug `log.Println` calls in `GetRecipeByID` while in there.

12. ~~Add e2e tests using playwright that cover the most common user flows, running locally.~~ **Resolved** — Playwright added, scoped to `e2e/` (TypeScript, its own `tsconfig.json`; rest of the repo stays plain `.js` per the still-open #9). `npm run test:e2e` runs `e2e/recipe.spec.ts` (add/edit/delete a Recipe - each test creates its own uniquely-named fixture and cleans up via a direct API call in `afterEach`, never through the UI's "Parse ingredients" box since that hits a real LLM) and `e2e/shopping-list.spec.ts` (add/remove a Recipe on the list, add an Extra Item, mark/un-mark an item bought, clear the list - run `test.describe.configure({ mode: 'serial' })` in a fixed order since the Shopping List is one singleton resource per Account under `DISABLE_AUTH`, bracketed by a `DELETE /shopping-list/clear` in `beforeAll`/`afterAll` so the suite is correct regardless of what a previous run left behind). `npm run test:e2e:debug` runs the same suite headed and slowed down (`E2E_SLOWMO`) for stepping through a scenario visually. Chromium only; `playwright.config.ts`'s `webServer` auto-starts `npm run dev:full` on pinned ports (`e2e/env.ts`) with its own `COMPOSE_PROJECT_NAME=bigshop-e2e`, and `npm run test:e2e:stop` (run automatically before `test:e2e`/`test:e2e:debug`) tears down any stale containers first - without it, a previous run's still-running containers hold the pinned ports and `dev-full.sh`'s own auto-increment-on-collision silently drifts to different ones. Explicitly out of scope: Dave, tag-filter browsing, URL/Photo Import (all either explicitly excluded or LLM-dependent). Documented in CLAUDE.md's Testing section, including when to run it. Remote/CI wiring is split out to #13.

    Getting this green surfaced three real, pre-existing issues, fixed alongside the test infra itself: (a) `components/shopping-list/ShoppingList/Item.js`'s bought-toggle was a bare `<li onClick>` with no button/checkbox role or accessible name - now a real `role="checkbox"` element; (b) `components/recipe-form/Form.js`'s "Delete Recipe" button was silently broken for **every real user**, not just tests - `use-http`'s `del()` only auto-adds `Content-Type: application/json` for POST/PUT/PATCH, not DELETE, so the JSON body went out as `text/plain` and the API's content-type validation 415'd it every time; fixed by setting a default `Content-Type` header on Form.js's `useFetch(...)` call. Also worth knowing for local dev generally: this worktree's untracked `.env.local` had `NEXT_PUBLIC_USE_MOCKS=true`, which silently overrides `.env.development` and puts the app in mocks mode even under `npm run dev:full` - not a code bug, but easy to lose an hour to.

13. ~~Run the e2e suite remotely, as part of CI.~~ **Resolved** — added `.github/workflows/e2e.yml`: triggers on every pull request (plus manual `workflow_dispatch`), and just runs the same `npm run test:e2e` the local docs already describe on a plain `ubuntu-latest` runner - GitHub-hosted runners ship Docker + Compose v2 out of the box, so `dev:full`'s `docker compose up -d db api` needs no extra setup. No secrets needed either: `.env.development`'s committed defaults (`NEXT_PUBLIC_DISABLE_AUTH=true`, mock-free) are what `webServer` picks up, same as local. One change needed alongside it: `playwright.config.ts`'s `reporter` was plain `'list'`, which writes nothing to disk - fine with a terminal to scroll back through, useless in CI - so it's now `[['list'], ['html', {open: 'never'}]]` under `process.env.CI`, and the workflow uploads that report (plus any failure traces from `test-results/`, already produced by the existing `trace: 'on-first-retry'` setting) as build artifacts. Explicitly **not** done: making this a required/branch-protection check - that's a repo-settings decision, not a workflow-file one, and is left for whoever owns that to turn on once the suite's been watched for a bit. **Since turned on** (2026-08-05), after a PR was merged before e2e had finished: the `required checks` repository ruleset now requires both `build-lint-test` and `e2e` on pull requests into `master`. Non-strict, and no pull-request requirement, so direct pushes to `master` still bypass it - see CLAUDE.md's Testing section.

15. ~~We need to make the "stored" state of adding a new recipe better from a ux and visual perspective.~~ **Resolved** — design decided via a grilling session, recorded in [ADR-0003](./docs/adr/0003-recipe-save-confirmation.md); implemented directly after. Save (create and edit) now redirects to `/recipes/{id}` with a new, generic `Toast` component (`components/toast/`) confirming "Recipe saved", replacing the old inline "Stored!"/"Updated!" text with no redirect. `POST /recipe` previously returned only `{status: "ok"}` with no way to know the new Recipe's id — `AddRecipe` (service/recipe.go) already computed it internally but discarded it, so it's now returned as `common.CreatedResponse{status, id}` (spec/types regenerated accordingly). Also folds in: "Add new recipe" button moved from `/recipes`'s `MainContent` into the shared `Sidebar` (`components/recipe-list`), so it now shows on `/recipes` and `/recipes/{id}` too; and a real `disabled`+`Spinner` guard on the Save button and the URL-fetch/photo-upload buttons on `/recipes/new`, closing a pre-existing double-submit gap (the old `loading` state only tinted the button's background via CSS).

16. ~~`pages/api/recipe-image.mjs` imported a `Blobs` class from `@netlify/blobs` that doesn't exist.~~ **Resolved** — found while converting the file to TypeScript (item 9): the installed version (`8.1.2`) only exports `Store`/`getStore`/`getDeployStore`, no `Blobs` class at all. `new Blobs(...)` would have thrown `TypeError: Blobs is not a constructor` on every invocation, meaning Photo Import's job-status persistence (the `updateJobStatus` helper, used by both the job-creation POST and the job-status-poll GET) was completely non-functional in production. Switched to `getStore({ token, siteID })`. The `{ ttl: 3600 }` option passed to `.set()` also isn't part of this version's `SetOptions` — dropped, since it was already inert given the above.

17. ~~`pages/api/dave/tools.ts` and `chat.ts` type recipe/OpenAI data as `any`, hiding a dead field.~~ **Resolved** — `tools.ts`'s `searchRecipes` now types the `GET /recipes` response as `RecipeSummary[]` (from `types/models`) instead of `any[]`. Typed properly, `recipe.description` *and* `recipe.ingredients` both failed to compile: `RecipeSummary` is `id`/`name`/`tags` only (confirmed against `docs/openapi.yaml`), so description-based and ingredient-based search/display were both dead, not just the field the original write-up flagged. Removed rather than faked in — adding a `description` field would be a backend/schema change out of scope here — so `searchRecipes` now filters by `name` and `tags` only, which is what it actually did all along. `getRecipeDetails`'s result is now typed `Recipe`, and `availableTools` is now `OpenAI.ChatCompletionTool[]`, dropping the `tools: availableTools as any` cast in `chat.ts`. `chat.ts`'s `openAIMessages`/`toolMessages` are now `ChatCompletionMessageParam[]`; the one remaining cast is on the unvalidated request-body messages (`msg.role`/`msg.content` are untrusted JSON), a real trust-boundary cast rather than a lazy one. `pages/api/dave/tools.test.ts`'s fixtures/expectations updated to match the real `RecipeSummary` shape — they previously encoded the buggy behaviour as the expected one.

18. ~~`NETLIFY_BLOB_STORE_TOKEN`/`SITE_ID` and Auth0 `domain`/`clientId` are asserted non-null (`!`) rather than validated at startup.~~ **Resolved** — added `lib/env.ts`'s `requireEnv(value, name)`, which throws a clear `Missing required environment variable: NAME` error instead of letting `undefined` pass silently through a `!` assertion. `pages/api/recipe-image.ts`'s two `getStore({...})` call sites now go through a shared `getBlobStoreConfig()` built with `requireEnv`. `pages/_app.tsx` only calls `requireEnv` for `NEXT_PUBLIC_AUTH0_DOMAIN`/`NEXT_PUBLIC_AUTH0_CLIENT_ID` on the branch already gated by `authDisabled` being false (i.e. only when Auth0 is actually required), so a misconfigured deploy with auth enabled now fails fast with a named error instead of handing `Auth0Provider` an unexplained `undefined`.

19. ~~`pages/recipes/[id]/edit.tsx` and `index.tsx` cast `router.query as { id: string }` without guarding `router.isReady`.~~ **Resolved** — extracted the duplicated cast into `hooks/use-recipe-id-param.ts`'s `useRecipeIdParam()`, which returns `undefined` until `router.isReady` instead of asserting `router.query` is already populated. `useRecipe`'s parameter type widened to `string | number | undefined`, and its fetch effect now returns early when `id === undefined` — the fix is behavioural, not just typing the lie away, so `GET /recipe/undefined` no longer fires on first render. Both page components now call `useRecipeIdParam()` in place of the inline cast. Covered by new tests: `hooks/use-recipe-id-param.test.ts`, plus two added cases in `hooks/use-recipe.test.ts` (`does not look anything up`/`does not fetch when id is undefined`).

20. ~~Open: replace `use-http` with a Strict-Mode-safe data-fetching library (SWR or TanStack Query) for read/GET requests.~~ **Resolved** — added `@tanstack/react-query`, with a `QueryClientProvider` mounted in `pages/_app.tsx`. First landed GET-only (every pure-GET hook/call site: `hooks/use-recipes.ts`, `use-recipe.ts`, three new atomic hooks - `use-tags.ts`, `use-units.ts`, `use-ingredient-names.ts` - that `use-ingredient-metadata.ts` composes, `components/recipe-list`'s tags fetch, `pages/account.tsx`'s `/invites` fetch, and the case that originally motivated this item, `components/recipe-form/Form.tsx`'s `getUnitsTagsAndIngredients`), with mutations deliberately left on `use-http` as a separate decision. That follow-up decision was then made immediately: every remaining `use-http` mutation call site was migrated to `useMutation` too, and `use-http`/`FetchProvider` removed from the codebase entirely (`package.json`, `pages/_app.tsx`) - one data-fetching library, not two. Covers `Form.tsx` (save/delete recipe, parse-text), `pages/account.tsx` (invite accept/reject/send), `pages/index.tsx` (onboarding upsert), `pages/list.tsx` (buy/regenerate/clear/add-extra - the trickiest file, since `getShoppingList`'s POST is triggered reactively off a `[recipeList]` effect rather than a button click, with a `hydrateFlag` one-shot-skip guard preventing the post-hydrate `setRecipeList` from immediately regenerating and dropping carried-over `isBought` state; that sequencing was left untouched, only the transport underneath it swapped), and `pages/recipes/new.tsx` (image upload + `/api/parse-recipe-url`, plus the job-status poll - previously a hand-rolled `setInterval`/`clearInterval`, now `useQuery`'s `refetchInterval` returning `false` once the job's `status` is `completed`/`failed`, with `enabled` tied to `processingJob` so polling stops the moment it's cleared - no manual interval bookkeeping left at all). Auth: every hook/mutation fetches its own token via `hooks/use-auth`'s `getAccessTokenSilently()` through `lib/api-client.ts`'s `apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete` (Go API, bearer-token authenticated) or `localApiGet`/`localApiPost`/`localApiPostFormData` (same-origin `pages/api/*` routes, unauthenticated - those routes never checked the token `FetchProvider`'s interceptor used to attach anyway) - no shared request interceptor left to depend on. Shared `queryKey`s (`use-units`/`use-tags`/`use-ingredient-names`) mean `/units`/`/tags`/`/ingredients` dedupe across call sites that both fetch them (e.g. `/recipes/new` mounting both `use-ingredient-metadata` and `Form.tsx`) instead of double-fetching. Verified with `npm run typecheck`, `npm run lint`, `npm run test` (98 passing), `npm run build` (shared `_app` bundle shrank ~7KB with `use-http` gone), `npm run test:e2e` (all 9 specs green against the real API/DB, exercising the Form.tsx and shopping-list mutation rewrites end-to-end), and a manual pass against the real local stack (`npm run dev:full`) for the two mutation flows e2e doesn't cover (`/account`'s invite-send, confirmed via the API container's access log showing a real `204` on `POST /invite`; `/recipes/new`'s manual-entry `Form` render).

14. ~~Open: deselecting your only selected Recipe on the Shopping List doesn't clear its Ingredient Items.~~ **Resolved** — `pages/list.tsx`'s `getShoppingList()` had `if (!selectedRecipes.length) { return; }`, which existed only to stop a regenerate call firing on the very first mount (before `hydrateShoppingList`'s fetch has populated `recipeList` from the server) — but it also silently blocked every *later* zero-selection case, i.e. actually unchecking your last Recipe. Replaced with a `hasHydratedRef` ref, flipped once `hydrateShoppingList`'s initial fetch resolves; `getShoppingList` now bails out only pre-hydration, not on every empty selection. The Go side already generated a correct empty list when posted `[]` (`GenerateShoppingList` removes existing Ingredient Items and skips the insert when `combinedIngredients` is empty) — this was purely a frontend guard bug, no backend change needed. Added a dedicated e2e test (`e2e/shopping-list.spec.ts`'s "deselecting your only selected recipe clears its ingredients", run first in the file while the list is still empty) in place of the old workaround-only comment; the existing "remove a recipe" test still keeps a second Recipe selected throughout, since that's still the more common real-world case worth covering separately. Verified via `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run test:e2e` (all 10 specs green, including the new one).

21. ~~Open: `e2e` CI job intermittently fails with "API did not become healthy in time."~~ **Resolved** — root cause matched candidate (b) flagged in the original write-up: `docker-compose.yml`'s `db` healthcheck ran `mysqladmin ping -h localhost`, and the MySQL client treats the literal host `localhost` as "connect via Unix socket" — the official MySQL image's entrypoint runs `docker-entrypoint-initdb.d` (our `01-migrate-and-seed.sh`) against a temporary, `--skip-networking` mysqld that still binds that same socket file, before the real, fully-networked server takes over. That let the healthcheck report `Healthy` while migrations/seeding were still running, so `api` (`depends_on: condition: service_healthy`) could start against a half-initialized DB — matching the observed failure shape (`db` Healthy, `api` Started, then the app-level `/health` poll timing out). Fixed by pointing the healthcheck at `-h 127.0.0.1` instead, which forces a real TCP connection — refused outright against the `--skip-networking` temporary instance, so `Healthy` now only fires once the real, post-init server is listening. Also added the diagnostics the original write-up asked for regardless: `.github/workflows/e2e.yml` now dumps `docker compose logs db api` (scoped to the `bigshop-e2e` project Playwright's `webServer` uses) to an uploaded artifact on failure, so any future recurrence has a real log to look at instead of a black box. Not separately pursued: the image-pull/build-eating-the-60s-budget candidate — `docker compose up -d --build` already blocks until images are pulled/built and `db` is healthy before `dev-full.sh`'s health-poll loop even starts, so that time was never actually counted against the 60-attempt budget; the healthcheck race was the one that could actually produce the observed symptom. Verified with a full local `npm run test:e2e` run against the changed healthcheck (all 10 specs green, `db` reported healthy and `api` started normally) — can't reproduce the original intermittent CI-only race locally to confirm it's gone for certain, so worth keeping an eye on the next few CI runs.

22. ~~`GetAllUnits` leaks a connection on early return.~~ **Resolved** — the follow-up said the pattern was worth grepping for rather than fixing one function, and it was: of 17 queries in the service package only 7 released their rows. All 17 do now. Two were worse than a leak: `GetAllIngredients` never checked the error from `db.Query` and dereferenced the returned `*sql.Rows` on the next line, so a failed query panicked; and `AddUserToAccount` issued two writes through `db.Query` instead of `db.Exec`, discarding both row sets and the first statement's error entirely.

23. ~~`insertUnits` creates unit abbreviations as separate Relative Units.~~ **Resolved** — `canonicalUnit` maps abbreviations and plurals onto the catalog's spelling and trims whitespace, applied once via `withCanonicalUnits` at the top of `AddRecipe`/`EditRecipe`. Deliberately not inside `insertUnits`: `insertParts` resolves a Unit by name too, so normalising in one and not the other would have them disagree and the part insert find no Unit row. Trimming matters independently — `UNIQUE(name)` is case-insensitive but not space-insensitive.

24. ~~A Recipe that has ever been added to the Shopping List cannot be deleted.~~ **Resolved** — `DeleteRecipe` now clears `shopping_list_event` before deleting the Recipe. Deleting rather than nulling `recipe_id`: the rows exist only for Dave's Recent/Favorite inference, `recipe_usage_summary` filters on `recipe_id IS NOT NULL`, and a deleted Recipe cannot be suggested. The reason it survived months of green CI is fixed too — `e2e/api.ts`'s `deleteRecipeById` ignored the response status, so every teardown of an affected Recipe failed silently. It asserts now.

25. ~~Audit the ingredient catalog for entries that are the same thing.~~ **Resolved** — migration `029` merges thirteen duplicate pairs, trims three whitespace-damaged names and deletes three orphans; 472 ingredients to 455. Done by hand, as the follow-up insisted: a similarity script would have merged `coriander` with `ground coriander`, which are genuinely different purchases (fresh, density 0.2, sold by the packet vs the ground spice at 0.5, measured in spoons). A review round folded the ground-spice fragments together — `cumin` and `cumin powder` into `ground cumin`, `ground turmeric` into `turmeric`, `ground chilli flakes` into `chilli flakes` — keeping the whole seeds separate, and resolved `chicken or ham stock` in favour of `chicken stock`. `spring onions` was merged into the singular against the 15-to-1 majority, because extract.js's prompt mandates singular names and `matchCanonicalIngredient` compares exact strings, so a plural entry would fragment on every future import. Verified by replaying `020`–`029` against a scratch copy of the production backup rather than against the local dev database, which is an older sync — that rehearsal is what caught `thyme sprig` being deleted with a live Ingredient Line still attached.

26. ~~Dry ingredients used only in volume units render as millilitres.~~ **Resolved** — migration `026` gives 15 dry ingredients a density so they combine into grams. The liquids in the same group keep millilitres, which was already right, but gain an explicit Base Unit.

27. ~~A curated Ingredient with no Ingredient Lines can be reclassified by an import.~~ **Resolved** — migration `028` adds `ingredient.curated`, and classification checks it instead of inferring from "has no Ingredient Lines yet". That proxy leaked both ways: a curated Ingredient stripped of its lines by `DeleteRecipe` could be overwritten, and an uncurated one that happened to be used by a Recipe could never be classified at all. This is the provenance column the spec deferred twice on the reasoning that NULL-vs-set expressed the rule — it did not, because NULL in `base_unit_id` means both "never curated" and "curated as the default, gram".

28. ~~No ingredient is displayed in spoons, which was half the point of problem 3.~~ **Resolved** — migration `027` gives 22 ground, powdered and seed spices a teaspoon Display Unit, with six densities added first because a Display Unit silently needs one. Herbs are excluded per the original wording, as are whole or fresh items that get counted rather than spooned. Doing it exposed a display flaw worth fixing on its own: the bracketed base amount exists to reveal an *estimate*, so it is now omitted when the conversion was exact — "6 teaspoon (2 tablespoon)" said nothing, while "5 teaspoon (12.5 gram)" shows the density it relied on.

29. ~~Extend the e2e suite to cover Recipe Import.~~ **Resolved** — `e2e/recipe-import.spec.ts` covers all three Import Sources, with the Next.js API routes intercepted by Playwright so no LLM call is made. The stated blocker ("makes a real LLM call") applied only to the route's internals, not to the plumbing between it and the save payload, which is where both Phase 4 bugs were.

    Each test asserts the proposed `baseUnit`/`unitSizes` survive extraction, the form and into the save request. Verified by reintroducing the original defect — dropping the fields in `normalizeParsedIngredients` — and confirming the suite goes red; it does.

    Two things learned worth keeping: the polling request carries `?jobId=`, so a `**/api/recipe-image` glob silently misses it and the real route runs (and fails on a missing Netlify Blobs token) — matched on `pathname` instead. And an earlier version asserted through the rendered Shopping List, which made an unrelated test time out: the list is one resource shared by the whole account and Playwright parallelises spec *files*, so `shopping-list.spec.ts`'s within-file serial mode does not protect it. Asserting on the captured payload avoids shared state entirely and is a tighter test of the actual defect.

30. ~~Audit TanStack Query cache invalidation properly.~~ **Resolved** — one deliberate pass over every mutation, as the item asked, rather than a blanket sweep. Two things came out of it: a decision per mutation (wired up, and tabulated in `technical-architecture.md`'s new "Data Fetching & Cache Invalidation" section), and `lib/query-keys.ts`, which is now the single definition of every cached `queryKey`.

    The registry is what makes the rest safe. A key now has two authors — the hook that reads it and the mutation that invalidates it — and one that drifts between the two doesn't fail loudly, it just quietly stops invalidating. It also caught a live trap: `hooks/use-recipe.ts` keys off the router param, always a *string*, while `Form.tsx` works from `Recipe.id`, a *number*. TanStack Query hashes keys structurally, so a hand-written `['recipe', recipe.id]` in the save handler would have matched nothing and silently done exactly what this item was filed about. `queryKeys.recipe()` coerces to string; `components/recipe-form/Form.test.tsx` guards it with a test that fails if the coercion is removed (verified by removing it).

    What invalidates: save Recipe → `['recipes']`, `['units']`, plus `['recipe', id]` when editing; delete Recipe → `['recipes']`, and `removeQueries` for `['recipe', id]`. `['units']` is the one the item predicted, and it was real — `insertUnits` upserts every Unit a Recipe's ingredients reference, so a save can create one the cached `/units` list has never seen, precisely the shape of the `['ingredients']` bug. Delete *removes* rather than invalidates because refetching a deleted Recipe would 404; confirmed empirically that removing a query with an observer still mounted leaves it rendering its last value rather than triggering that doomed refetch.

    What deliberately doesn't, which the item was equally clear about: `['tags']` — `/tags` reads the `tag` table, a fixed list the app never inserts into, since saving a Recipe only writes `recipe_tag` join rows (also covered by a test). Sending an invite — `GET /invites` returns invites addressed to *this* user, so the sender's own list is unchanged. The three extraction calls (URL, photo, pasted text) — they write nothing; the Ingredients and Units an import introduces are created when the Recipe is saved, and it's the save that invalidates. Onboarding — no cached query reads User state. Every one of these carries a comment saying so, so the next reader can tell a decision from an oversight; that is the convention the section records.

    Accepting an invite turned out to be the strongest case in the app and wasn't on the item's list: it moves the user into a *different Account* server-side (`DisableUserAccount` then `AddUserToAccount`), so every cached query describes the account they just left. It invalidates everything.

    On the third bullet — `pages/list.tsx` — the answer is that local state is right, and it's now written down rather than left implicit. Nothing outside that page reads Shopping List data, so there's no second consumer to keep in sync, which is the problem a shared cache solves; the staleness that motivated this item is real precisely because `['recipes']` and `['units']` *are* read from several places. The regenerate call already returns the recomputed list, and the optimistic buy/add-extra updates would become the same write via `setQueryData` plus rollback plumbing.

    Four tests added to `components/recipe-form/Form.test.tsx`. They assert on cache state rather than on what the user sees, because the failure mode is invisible locally: a missing invalidation still looks right, since navigating away remounts the consumer and refetches anyway — it only shows as a stale flash. Writing them surfaced the same trap from the other side: invalidating a key with no entry in the cache is a silent no-op, so the tests have to seed the cache to mean anything. Verified with `npm run typecheck`, `npm run lint` and `npm run test` (118 passing).

32. ~~`react-hooks/set-state-in-effect` is switched off, and shouldn't stay that way.~~ **Resolved** — the rule is enabled. Five of the ten sites were fixed by removing the state that caused them, rather than by rearranging the effect:

    - `hooks/use-viewport.ts` and `hooks/use-page-visibility.ts` now use `useSyncExternalStore`. Both were subscribing to a browser store (`window.innerWidth`, `document.visibilityState`) in an effect and seeding the initial value with a `setState` in the effect body, so every mount rendered once at a placeholder and again at the real value. `useSyncExternalStore` has the real value on the first render, and takes the SSR snapshot as an explicit third argument (320px, and "visible") instead of leaving it implicit in a `useState` default.
    - `components/recipe-form/Form.tsx` had two effects maintaining a `units` state: one seeding from the fetched catalog, one appending synthetic entries for units an import introduced that the catalog lacks (e.g. "bunch"). Nothing else ever called `setUnits`, so the state was pure duplication of two inputs — it is a `useMemo` now, and the state is gone. This path had no direct test despite being the reason the state existed; `Form.test.tsx` gained two covering both the catalog and synthetic cases.
    - `pages/account.tsx` copied the fetched invites into state so accept/reject could optimistically drop a row. It now tracks the dismissed tokens instead and derives the list. That also fixes a latent bug: the effect only copied when the response was non-empty, so a server response of `[]` left the previous list on screen.

    The remaining five sites keep the effect and carry a per-site `eslint-disable` with its reason in the code, rather than the blanket suppression this entry was opened about. Each is a deliberate design where deriving would change behaviour: `Form.tsx`'s `initialRecipe` reset (the form must stay locally editable, and remounting via `key` would discard typing in progress), `pages/recipes/[id]/index.tsx`'s save toast (the URL param it reads is stripped on the same tick, so it cannot be derived from the URL), `pages/recipes/new.tsx`'s Photo Import polling (TanStack Query v5 removed `useQuery`'s `onSuccess`, leaving no callback to move it into), and `pages/list.tsx`'s hydrate/regenerate pair (the interaction that file already warns about, where regenerating without a real recipe change deletes `isBought` data). Those four are worth revisiting individually; none of them is a lint problem any more.

33. ~~`e2e/` is excluded from linting and should get its own config block.~~ **Resolved** — `eslint.config.mjs` replaces the blanket `e2e/**` ignore with a scoped `files: ['e2e/**']` block that turns off `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` and leaves everything else on. Those two cannot apply to a directory with no React components, and one actively misfired: a Playwright fixture is written `async ({ page }, use) => await use(...)`, which `eslint-plugin-react-hooks` reads as calling a hook named `use` (React 19's) inside a non-component function named `page`. `e2e/` is now linted for the first time and was clean on adoption.

36. ~~Put the brand back into the Shopping List.~~ **Resolved** — colour and weight back on top of the one-sheet layout, which is unchanged. Each item from the original list, and what it turned into:

    - **Logo** (`components/layout/header.module.css`) — icon stroke and wordmark are both `--spot`, not `--ink`. `--spot` rather than `--color-primary` because it's the token that exists precisely to be *type* on paper; `#b870eb` at 30px is legible but weak against `--paper`.
    - **Checkbox** (`components/shopping-list/ShoppingList/index.module.css`) — a `--color-primary` ring unbought, filled `--color-primary` with a white tick bought, `--spot` on hover for both. This is the change that does the most work: it's the control you touch every time you shop, and it was a grey circle filling with ink.
    - **A real primary button** — "Add" is `<Button style="primary">` (`components/shopping-list/Recipes/AddExtra.tsx`), sized down to sit level with the underlined input beside it. It is the only solid button on the page, which is the point.
    - **Selected recipes in the rail** (`components/sidebar-item/index.module.css`) — `--spot-wash` background, `--spot` name, `--color-primary` tick, in place of a `--paper-deep` block with an ink tick. `--spot-wash` is a new token: an alpha of `--color-primary` rather than a flat tint, so warm paper shows through — `--color-primary-soft` is mixed against white and reads cold and grey on top of `--paper`.
    - **The masthead count** — deleted, along with `ShoppingList`'s `recipeCount` prop (nothing else wanted it) and the `plural` helper.
    - **Clear list** — moved up into the masthead, into the space the count vacated. It stays a text action rather than becoming a button: beside a 40px serif title, a solid button competes with the title, and it's destructive. Its two-step confirm is unchanged.
    - **The empty-basket illustration** — back to roughly its pre-redesign size (`clamp(180px, 34vw, 260px)`, was 110px). Still set beside the copy, not centred above it — centring is what left a screen-high void — and the row wraps only when the column is too narrow for both.
    - **Uppercase titles** — gone. `SidebarHeading` and "Already bought" are lowercase `--font-heading` at `--text-md`, still terracotta. The letter-spaced small-caps label is the single most generic thing a UI can wear.
    - **Renamed** — "Non-recipe items" → "Fancy something extra?", "All Recipes" → "Your recipes" (the latter is `components/recipe-list`, so `/recipes` gets it too).
    - **Global nav** — the active-link underline is `--color-primary`, was `--terracotta`. `/list`'s mobile tab bar followed it: same idiom one row below, so two accent colours there read as a mistake.

    Not done in this pass, and deliberately: `/dave`. The original item asked for it to be looked at alongside; it's carried forward as its own entry in `follow-ups.md` instead.

39. ~~Shopping List amounts are far more precise than anyone can shop
    (`4.444444 teaspoon (10 gram)`).~~ **Resolved** — one rounding pass,
    `RoundAmountsForShopping` in `netlify-functions/recipes/internal/pkg/service/list.go`,
    applied in `GetShoppingList` immediately after `ApplyDisplayUnits` and nowhere
    else. Both decisions the item asked for:

    - **Where.** The Go API rather than `Item.tsx`'s `formatAmounts`, which the item
      leaned towards. The rule can't be blind, and everything that stops it being
      blind — whether a Unit is Relative, its Kind, its Factor — lives in the Unit
      Catalog, which the frontend does not have: `/units` returns `{id, name}` only,
      so the display layer would have had to hardcode a list of unit names to know a
      tin rounds differently from a gram. The "round once, at the end" property the
      item actually wanted is kept by *where in the read* it runs, not by which
      process runs it: it is the last thing to touch the Amounts before they're
      serialised, and the stored totals are untouched.
    - **The rule.** Unit picks the granularity, and anything not weighed on a scale
      rounds **up**, because rounding down means going home without enough. A
      Relative Unit (tin, clove, bare count) to a whole, minimum one. A
      measuring-spoon Unit to a quarter — `4.444444 teaspoon` → `4.5`, `0.2222` →
      `0.25`, since a cook can measure a quarter spoon and cannot measure 0.3 of one.
      A weight or volume to nearest, at a precision scaled to its size: whole numbers
      from 10 up (`63.333333 gram` → `63`), one decimal below that (`1.04 kilogram` →
      `1`), and two significant figures under 1, so `0.44444 kilogram` → `0.44` and
      `0.041666` → `0.042` rather than either rounding away to zero.

    "Measuring spoon" is a size test — a volume Unit with a Factor above 1 and up to
    50 — not a list of names, so a `dessertspoon` arriving via an import behaves like
    the teaspoon and tablespoon already in the catalog. Millilitre is excluded by the
    `> 1`: you measure a quarter teaspoon, never a quarter millilitre.

    `formatDisplayQuantity` is gone, folded into the new `formatShoppingQuantity` —
    its round-up-to-a-whole rule for Relative Display Units was the same rule, and
    the item was right that it was the precedent to follow rather than a new
    principle. That rule now also reaches Amounts that were never converted (a
    `1.75 tin` total that was already in tins). The bracketed working is rounded too,
    in its own Unit, since the same person reads it. An unreadable quantity ("a
    handful") is still passed through verbatim, per `ParseQuantity`'s contract, and
    zero is not rounded up to one — that would invent an item to buy.

40. ~~URL import returns an empty `ingredients` array for some recipe sites.~~
    **Resolved** — reproduced exactly as reported on the BBC Good Food URL, and it
    was (a), the extract step, not the LLM. Two compounding causes in
    `lib/recipe-import/url.js`, both fixed:

    - **The JSON-LD was being thrown away.** `NOISE_SELECTOR` stripped every
      `<script>`, which is where a site's schema.org `Recipe` lives. That page
      publishes a perfect one — name, all six ingredients, both method steps.
    - **The truncation cut before the ingredients.** What was left was *markup*,
      mostly class attributes: 165,455 characters, with the recipe name at ~80,000
      and the ingredients at ~108,000, against a 60,000-character limit. The model
      was handed 60KB of navigation and asked for a recipe, so an empty
      `ingredients` array was a reasonable answer to the question it was actually
      asked.

    `htmlToInput` now prefers the page's JSON-LD `Recipe`, rendered as a compact
    plain-text recipe, and falls back to the page's *visible text* (plus its
    `<title>`) rather than its markup. The same page is 6,109 characters of visible
    text, so the limit stops being something a real page can reach — that fallback
    alone would have fixed this URL, which is why both landed rather than just the
    JSON-LD path. The JSON-LD reader handles the shapes sites actually publish:
    `@graph` nesting, `@type` as an array, `HowToSection`-wrapped steps, markup
    inside the JSON strings, and a malformed block sitting next to a good one. A
    `Recipe` node carrying no ingredients falls through to the page text rather than
    being trusted.

    Also fixed, and the reason this was worse than a visible failure: an extraction
    with no ingredients now 422s from `pages/api/parse-recipe-url.ts` with a message
    the New Recipe page already knows how to show, instead of opening an empty
    Recipe form that looks like the page had no ingredients.

    Regression test where the item said it belonged — `lib/recipe-import/url.test.ts`,
    against a verbatim saved copy of the real page in
    `lib/recipe-import/__fixtures__/`. It is checked in at full size (533KB) on
    purpose: the bug *was* the page's size, so a trimmed fixture would pass against
    the broken code it exists to catch. Verified end to end against the live URL with
    a real extraction call, which now returns all six ingredients and the method.

44. ~~Audit `Cache-Control` across the Go API.~~ **Resolved** — see [ADR-0009](./docs/adr/0009-edge-caching-the-global-catalogs.md) and `specs/completed/cache-control-audit.md`. Every response now carries a policy: a `private, no-store` default stamped by middleware in `internal/pkg/app/app.go`, first in the negroni stack so it covers `/health` and the JWT middleware's own 401s, not just handler successes. Three routes override it, each as the audit concluded — `GET /tags` `public, max-age=0, s-maxage=86400` (no purge; `tag` is seeded by migration and never written to), `GET /units` `public, max-age=0, s-maxage=300` plus `Netlify-Cache-Tag: units`, purged on Recipe create/edit, and `GET /ingredients` `no-store` (it is read server-side via `API_HOST_INTERNAL` and never crosses the edge, so caching buys it nothing). The purge lives in a new `internal/pkg/purge` package: asynchronous, best-effort, and coalescing — one call goes immediately and a burst collapses into one trailing call per 5s window, because Netlify 429s a tag purged more than twice in five seconds. It is a no-op with `NETLIFY_PURGE_TOKEN`/`NETLIFY_SITE_ID` unset, which is what local dev, e2e and CI run as; the `s-maxage` is what makes a missed purge self-heal. **One correction to this item as filed:** it counted 22 routes with nineteen account-scoped. There are 25, of which 22 are account-scoped — three were added after it was written. None of its conclusions change; the three unscoped routes are the same three. **A second correction:** this item named an in-process cache in `lib/recipe-import/known-names.ts` as "the real win" for `/ingredients`. That was too quick — tracing the callers afterwards showed the round trip is Ohio to Frankfurt and back, on every import, for an unbounded catalog, and that routing the call through `www.bigshop.life` would make it edge-cacheable after all. Reopened as item 51 in [`follow-ups.md`](./follow-ups.md), which frames the choice rather than presuming it.

48. ~~You cannot log in on a deploy preview, so branch deploys cannot be tested.~~
    **Resolved** — verified end to end by completing a real login, and a real logout, on a
    branch deploy. Runbook: [`docs/deploy-previews.md`](./docs/deploy-previews.md).

    Two layers, and the console setting was the second one, not the first.
    `NEXT_PUBLIC_HOST` is inlined at build time and `.env.production` pins it to
    `https://www.bigshop.life`, so *every* production-mode build — previews included — used
    the live site as its own origin. Six call sites, fixed in two groups:

    - **Auth0 needs an absolute origin**, because it is handed to a third party.
      `redirect_uri` (`pages/_app.tsx`, `hooks/use-login.ts`) and logout `returnTo`
      (`components/identity/logout`) now read `window.location.origin` via the new
      `lib/app-origin.ts`, which falls back to `NEXT_PUBLIC_HOST` under SSR.
      `lib/app-origin.test.ts` guards the build-time value never winning in the browser
      again.
    - **This app's own Next.js API routes never wanted one at all**, and are now relative
      paths. This was the worse half: prefixed, `pages/recipes/new.tsx`,
      `components/method-import` and `components/recipe-form/Form.tsx` were making
      cross-origin calls into **production's** `/api/parse-recipe-url`,
      `/api/parse-method-url` and `/api/recipe-image`, so import features on a preview
      appeared to work while exercising code that was not on the branch. The rule is
      written down in `lib/api-client.ts` next to the helpers.

    **The Auth0 half could not be solved in the repo, and not by a wildcard either.**
    Netlify preview hosts are `deploy-preview-<N>--big-shop.netlify.app`, and Auth0 requires
    `*` to be the leftmost subdomain component *followed by a dot* — so
    `https://*--big-shop.netlify.app` is not expressible, and `https://*.netlify.app`, which
    is, would grant callbacks to every site on Netlify. The answer is one stable alias
    instead of every numbered preview: a branch deploy on a fixed `preview` branch, added
    once to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins. Push a
    branch into that slot (`git push --force origin <branch>:preview`) to exercise it. A
    numbered preview still cannot be logged into, deliberately.

    Two things worth keeping in mind next time this is touched. Auth0 matches the callback
    string exactly and the app sends the **bare origin with no trailing slash**, so an entry
    ending in `/` silently fails. And **Allowed Web Origins matters as much as the callback**
    — the app sets `useRefreshTokens`, so without it login completes and the token call then
    fails CORS, which looks like a different bug entirely.

    Unchanged, and not what this was about: per
    [ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md), a preview still proxies
    to the single production Fly API, so it exercises production data. Previews are for
    frontend changes; API changes are verified against the local stack and the e2e suite.

49. ~~Investigate why a request costs ~160ms per query, not ~90ms — and why `GET /shopping-list`
    issues nine of them.~~ **Resolved** — measured 2026-08-09. The premise in the title is
    wrong in a way that turns out to be the whole answer: the request does not issue nine
    round trips at ~160ms each. It issues **fifteen**, at roughly the ~90ms
    [ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md) assumed all along. Nine
    was a count of *queries*, and a query is not a round trip.

    **A parameterised query costs two round trips, not one.** `database/sql` hands a query
    carrying arguments to `go-sql-driver` as a server-side prepared statement, because
    `mysqlConn.query` returns `driver.ErrSkip` for anything with arguments unless
    `interpolateParams` is set, and it is not set. So each one goes `COM_STMT_PREPARE`,
    wait, `COM_STMT_EXECUTE`, wait. (`COM_STMT_CLOSE` follows but the MySQL protocol sends
    no reply to it, so it costs nothing to wait for.) A query with *no* parameters is sent
    as a single `COM_QUERY` and costs one. `GET /shopping-list` runs six of the former and
    three of the latter:

    | Call | Statements | Blocking round trips |
    | --- | --- | --- |
    | `GetRecipesFromList` | `GetAccountID` + 1, both parameterised | 4 |
    | `GetIngredientListItems` | `GetAccountID` + 1, both parameterised | 4 |
    | `GetExtraListItems` | `GetAccountID` + 1, both parameterised | 4 |
    | `GetUnitCatalog` | 1, no parameters | 1 |
    | `GetIngredientCatalog` | 2, no parameters | 2 |
    | | | **15** |

    **How it was measured, because counting is exactly what went wrong the first time.**
    A `toxiproxy` was inserted between the API container and MySQL, injecting a known delay
    on each server response, and the endpoint timed at several delays. Total request time is
    linear in injected latency and **the slope is the round-trip count** — no interpretation
    required, and immune to how the driver chooses to log itself:

    | Injected latency | `GET /shopping-list` |
    | --- | --- |
    | 0ms | 6.3ms |
    | 10ms | 185.2ms |
    | 25ms | 415.5ms |
    | 50ms | 788.2ms |

    Slope **15.2 round trips**, against 15 counted from MySQL's general log. Re-run with
    `interpolateParams=true` in the DSN, the slope falls to **9.2** — which is the nine the
    ADR counted, and confirms the mechanism precisely: that flag is exactly the difference
    between a query and a round trip here.

    **The arithmetic closes.** 15 × ~90ms is ~1,350ms of the Lambda's 1,624ms. The rest is
    the Netlify-edge-to-`us-east-2` hop, plus one transatlantic round trip nobody had
    counted at all — see the JWKS finding below.

    **The connection-establishment hypothesis was real but not the answer.** Measured the
    same way, a TLS MySQL connection costs **~5.0 round trips** to establish (plain TCP:
    ~3.0), so ~450ms transatlantic against TiDB. But that is paid once per connection, not
    per request, and the ADR's samples were warm. It was the right instinct — the request
    *was* paying for something other than queries — applied to the wrong term. Where it did
    bite is exactly where ADR-0006 already says it did: every cold Lambda container built a
    fresh pool during `init()`.

    **Two things found on the way that are worth more than the original question.**

    - **`POST /shopping-list` is far worse than the endpoint that was measured**, and it is
      the one that does the actual work. Measured at **~57 blocking round trips** for a
      two-recipe list (census: ~50), resolving `GetAccountID` **nine** times. It loops
      `GetRecipeByID` per Recipe, so it grows with the size of the list — ADR-0006's "no
      N+1 loops" is true of `GET`, not of `POST`. On the Lambda that was ~5 seconds. Filed
      as #53.
    - **Every authenticated request re-fetched the Auth0 JWKS**, uncached, before touching
      the database — `getPemCert` in `internal/pkg/app/app.go` does a bare `http.Get` and
      `go-jwt-middleware` v1 calls it per request. Confirmed by measurement, not by reading:
      against the real tenant, a request with a well-formed token costs ~15–18ms where one
      with no token at all costs ~2ms, on every request rather than the first. On the Lambda
      that was a transatlantic hop to an EU Auth0 tenant on every single request. Filed as
      #54.

    **What was already true and stays true: none of this is urgent.** At 165ms the endpoint
    is fine and the migration took ~90% of the cost out. The point of the item was to
    understand the reason before anyone optimised on a guess, and the reason turned out to
    contradict both the guess *and* the number in the title.

    One note for #44, which landed alongside this and reasoned about a query profile that
    had never been measured. Nothing in its conclusions depended on the count, and none of
    them change: the three cacheable routes are the three cheapest here (1 round trip each),
    and the expensive routes are all account-scoped and correctly `private, no-store`. What
    the measurement adds is why that split is so lopsided — the mutable routes are not
    merely uncacheable, they are where every round trip actually is.

    Fixed here rather than filed, being a real defect found directly on the measured path:
    **a token whose `kid` names no key in the tenant's JWKS panicked the handler** instead
    of returning 401. Anyone could send one — the audience and issuer checks pass on public
    values, and the key lookup is the next step. `net/http` recovers per-connection so the
    process survived, but the caller got an empty reply and a torn-down connection rather
    than a refusal. The same defect `normalizeAudience`'s comment describes, one branch
    further down. Now returned as an error, with a regression test
    (`TestKeyLookupFailureIsRefusedNotPanicked`) that unwinds on the panic; the discarded
    error from `jwt.ParseRSAPublicKeyFromPEM` next to it, which returned a nil key with a
    nil error, is returned too.

53. ~~Cut the round trips per request, now that there is a measurement to cut
    against.~~ **Resolved** — all six phases of
    [`specs/completed/request-model-optimisations.md`](./specs/completed/request-model-optimisations.md)
    have shipped. Phases 1-3 landed first (JWKS caching, `interpolateParams`, the lazily
    resolved `Caller`); Phases 4-6 landed together and are what closes this.

    Measured on the rig the spec describes — toxiproxy between the API and MySQL, slope of
    total request time against injected downstream latency, which *is* the blocking
    round-trip count. Before/after here is against `master` with Phases 1-3 already in, not
    against the original #49 baseline:

    | Route | #49 baseline | after Phases 1-3 | after 4-6 |
    | --- | --- | --- | --- |
    | `GET /shopping-list` | 15 | 7.03 | **2.08** |
    | `PATCH /shopping-list/buy` | 19 | 8.09 | **2.02** |
    | `POST /shopping-list` (1 Recipe) | 42 | 18.41 | **8.16** |
    | `POST /shopping-list` (2 Recipes) | 50 | 21.45 | **8.10** |

    The last row is the one that mattered most and the one a single-size measurement could
    not have seen: the **slope went flat**. `POST /shopping-list` cost +3.04 round trips per
    additional Recipe and now costs -0.06 — i.e. nothing. A ten-Recipe list was ~114 round
    trips at the #49 baseline and is now the same 8 as a one-Recipe list. Two per-Recipe
    loops caused it, both replaced by one statement: `GetRecipeByID` per Recipe (now
    `GetRecipeIngredientsByIDs`, one query over the whole set) and `LogShoppingListEvent`'s
    `INSERT` per Recipe (now one multi-row `INSERT`).

    `GET /shopping-list` landing on 2.08 is exactly what the spec projected for
    "+ Phase 5b", which is worth saying because the spec was explicit that only the Phase 2
    figure was measured end to end and "the rest are counted, and counting is exactly what
    #49 caught being wrong". This time the counting was right.

    Correctness was checked by diffing the full `GET /shopping-list` and `GET /recipe/{id}`
    responses between `master` and the branch against the same database: byte-identical,
    except that the `recipes` array now comes back in `list.id` order rather than whatever
    `SELECT DISTINCT` felt like. Nothing reads that order.

    **What each phase actually did.** 4a: `PATCH /shopping-list/buy` returns
    `StatusOutput` instead of re-running the whole of `GetShoppingList` to build a body
    `pages/list.tsx` discards — 15 of its 19 original round trips were dead work end to end.
    4b: the two per-Recipe loops above. 5a: `GetRecipesFromList`, `GetIngredientListItems`
    and `GetExtraListItems` collapse into one `GetStoredList`, which reads the `list` table
    once and partitions in Go. 5b: `service.Catalogs` holds the Unit and Ingredient catalogs
    in process behind a 5-minute TTL, invalidated from the same call site that purges the
    `units` edge tag — one place that knows the catalog changed, not two that have to stay
    in step. 6a: the connection pool is chosen deliberately (20/8/5min) against TiDB Cloud
    Starter's real 400-connection ceiling, with `db.Stats()` exported as OTel metrics so the
    choice can be checked; the old `MaxIdleConns` default of 2 would have made 6b *slower*
    than sequential. 6b: `GET`/`POST /shopping-list` run their independent reads under an
    `errgroup`.

    Two things the phases were expected to buy and did not, or not much. 6b is worth almost
    nothing on `GET /shopping-list` now — with the catalogs in memory there is only one
    read left to be independent of anything, so it earns its keep on the first request after
    a Recipe save and nowhere else. And 5b's cache is the reason, which is the spec's own
    point that "parallelising four round trips saves less than not making eleven of them"
    arriving one phase earlier than expected.

56. ~~Deleting an already-deleted Recipe returns 500, and it makes the e2e suite flaky.~~
    **Resolved** — `app/recipe.go`'s `deleteRecipe` now has the `errors.Is(err, sql.ErrNoRows)`
    branch the service layer was already written for: `service/recipe.go` returns that sentinel
    deliberately unwrapped, with a comment about not breaking "any caller comparing against it",
    and the one caller finally does. A Recipe that is not on the Account answers **404 Recipe not
    found**; everything else still answers 500.

    Both branches now go through `fail(ctx, clientErr, cause)` rather than returning the client
    error bare, which is what the rest of the package does. That has two consequences worth
    stating: a 500 from a delete now records its *cause* on the span instead of only the generic
    message the client saw, and the 404 is deliberately **not** flagged as a server error —
    `fail` treats `sql.ErrNoRows` as the one expected cause, so a missing Recipe cannot inflate
    the error rate the dashboards read.

    **The flake needed the e2e side too, and that is the half the item did not spell out.**
    `deleteRecipeById` asserts on the response status (added by #24, deliberately), so a 404 was
    still a failed teardown — it only stopped being a *lie* about why. It now returns early on
    404 and throws on everything else: teardown deletes by id, spec files run in parallel against
    one shared Account under `DISABLE_AUTH`, and a Recipe can be gone before its own teardown
    runs, so "already gone" is a successful teardown. #24's protection is untouched — the 500 that
    went unnoticed for months would still fail the suite today.

    Covered by an e2e test (`recipe.spec.ts`, "deleting a recipe that is not there is a 404, not
    a 500") rather than a Go one, because reaching the branch needs a real database and #52 is
    still open. Also deleted a stale comment in `shopping-list.spec.ts` claiming those teardown
    deletes silently fail and that `deleteRecipeById` does not assert — both untrue since #24.

58. ~~A logged-in user sees the marketing page flash before the homepage realises who they
    are.~~ **Resolved** — by removing the redirect rather than hiding it. `/` no longer sends a
    logged-in visitor to `/list`; it renders for everyone, and the header says where their list
    is. Three states collapse to one, so there is no marketing → blank → `/list` sequence left
    to flash.

    **One finding changed the design, and is worth recording because the item argued from the
    opposite assumption.** `pages/index.tsx` has no `getServerSideProps`, so `/` is statically
    pre-rendered: the marketing HTML is served from Netlify's CDN and painted long before React
    hydrates. Direction 1 as filed - a synchronous read of the SDK cache from inside the
    component - therefore *cannot* remove the flash. It moves the seam from "until `POST /user`
    returns" to "until hydration completes" and no further. Nothing done inside a component can
    change what the first paint shows.

    So the choice was really between direction 2 (middleware) and a third option that the item
    did not list: stop redirecting at all, and let the header carry the logged-in state, which
    is what most product sites do. Direction 2 was costed and rejected on three counts - it puts
    a Netlify Edge Function on the highest-stakes public route; the
    `auth0.<clientId>.is.authenticated` cookie expires after a day, which is shorter than the
    refresh-token session, so the flash returns for anyone away for two; and a stale cookie
    loops against `_app.tsx`'s bounce back to `/`, needing a marker param to break. It also
    means a logged-in user can never see the homepage, which #47 (read the marketing copy by
    hand) would rather they could.

    **What shipped.** Three parts:

    - **No redirect on an ordinary visit.** `POST /user` still runs unconditionally - it is what
      creates the User row and its Account on a first login, and `/` is its only caller - but an
      onboarded user now stays put.
    - **One redirect survives**, and only for the Auth0 callback. `hooks/use-login.ts` sets
      `redirect_uri` to the app origin, so clicking Log in returns you *here*; staying put would
      make the button look broken. `lib/auth-callback.ts` recognises that arrival by the
      `?code=&state=` Auth0 appends. It is computed at module scope on purpose: `Auth0Provider`
      strips those params with `history.replaceState` in a mount effect, so anything reading
      `location.search` from inside a component is racing it.
    - **A pre-paint hint**, which is the surviving half of direction 1 and the only place it can
      work - a blocking inline script in a new `pages/_document.tsx`, running before the body is
      painted. It guesses from Auth0's own storage (the `is.authenticated` cookie, then the
      `@@auth0spajs@@::<clientId>` cache prefix) and stamps `data-auth` on `<html>`;
      `index.module.css` decides the header button and both CTAs from it; `index.tsx` overwrites
      the stamp with the truth once the SDK answers. React sets the attribute and never branches
      on it, so server and client markup are identical and there is no hydration mismatch.

    A guess is safe here **because of what rides on it**: which of two buttons is visible. Guess
    wrong and one button settles a moment later - unlike a redirect or a blanked page, which is
    what made this approach worth taking over hiding the whole page. The unset default is the
    logged-out page, so a script that throws, a browser with JS off, or a future SDK that moves
    its storage all degrade to exactly today's behaviour.

    **Two things fell out of it.** The CTAs had to move onto the stamp too: with the page now
    visible to customers, telling one to "Add your first recipe" under the word "Free" is
    nonsense. That subsumed the old `status === 'onboarding'` render flag, which reached the same
    two variants by a narrower route (a first-time user, once); `status` now decides the redirect
    and nothing about what is rendered. And the returning-from-Auth0 case gets its own stamp
    value, veiling the page with `visibility` while `/list` is already on its way.

    Not addressed, and the one real cost: a returning user who types the bare domain no longer
    lands on `/list` in one keystroke. `public/manifest.json`'s `start_url` is already `/list`,
    so the installed PWA is unaffected, and the header link is one click. Worth watching rather
    than pre-emptively undoing.

    Covered by `lib/auth-callback.test.ts`: the callback predicate (including that
    `?promocode=…&estate=…` is *not* one - substring matching would have redirected a first-time
    visitor into an account they do not have), and the `@@auth0spajs@@` prefix asserted against
    auth0-spa-js's own public `CacheKey`, so an SDK upgrade that moves the storage fails a test
    rather than silently turning the hint into a no-op.
