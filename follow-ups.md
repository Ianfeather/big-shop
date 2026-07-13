# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

1. ~~CLAUDE.md: stale `pages/api/third-parties/*` doc entry.~~ **Resolved** — CLAUDE.md was split into CLAUDE.md + `technical-architecture.md`; the latter's "Next.js API Routes" table now correctly documents `parse-recipe-url.js`/`parse-recipe-text.js` in place of the deleted per-site scrapers.

2. ~~CLAUDE.md: wrong table name for shopping list history.~~ **Resolved** — `technical-architecture.md`'s "Database Schema" table now correctly names `shopping_list_event` (an append-only event log, not snapshots).

3. ~~`RemoveUserFromAccount` is broken.~~ **Resolved** — `netlify-functions/recipes/internal/pkg/service/account.go`'s `DELETE` now targets `account_user` (was `user_account`, a table that doesn't exist), and uses `db.Exec` instead of `db.Query` (the latter was leaking an unclosed `*sql.Rows` on every call). `DELETE /account/remove` works.

4. ~~`ingredient_department` has no unique constraint on `ingredient_id`.~~ **Resolved** — `migrations/017_ingredient_department_unique.sql` adds `UNIQUE (ingredient_id)`, following the same convention as `016_unit_unique.sql`. A duplicate insert now fails at write time instead of silently fanning out an Ingredient Line via `recipe.go`'s `LEFT JOIN`.

5. **Open: informal count units (bunch/handful/pinch) vs. true discrete counts (1 tomato, 1 egg).** Both currently fall under `unit_type = 'count'` in the proposed `unit-normalisation.md` schema, but a single `average_weight_grams` per Ingredient can't correctly represent both. Punted for now, same as `density-conversion.md` already punts on weight/volume merging — needs its own resolution before Phase 3 of `unit-normalisation.md` ships.

6. ~~Generating the Shopping List resets bought-state on every Ingredient Item.~~ **Resolved** — `createListHandler` now fetches the existing ingredient list before regenerating and carries `is_bought=true` forward for any ingredient name that survives into the new combined list; `AddIngredientListItems` inserts the carried-over value instead of a hardcoded `false`. Extra Items were already, and remain, unaffected.

7. **Generate an OpenAPI spec for the Go API.** No spec exists today; `technical-architecture.md` deliberately points at `internal/pkg/app/app.go`'s `GetRouter` as the source of truth rather than restating routes by hand (the hand-written version in the old CLAUDE.md had already drifted — missing `GET /shopping-list/history`). Worth generating a real spec once there's tooling to keep it in sync with the code (e.g. swaggo-style annotations + codegen, or reflection-based generation) — a hand-authored spec with no CI tie to `app.go` would just recreate the same drift problem in a new file.

8. **No frontend testing framework established.** Go API has `go test`; the Next.js/React frontend has nothing (moved out of CLAUDE.md's Testing section, which previously just noted the gap in prose). Needs a decision on framework (e.g. Jest/Vitest + React Testing Library, Playwright for e2e) and initial setup.

9. **Convert the frontend to TypeScript, so it can be type-checked.** `pages/`, `components/`, and `hooks/` are all plain `.js` today (per `technical-architecture.md`'s Component Structure/Custom Hooks sections) — no compile-time type checking exists anywhere on the frontend. Would need a migration plan (incremental via `allowJs`/`checkJs`, or a `.js`→`.tsx` sweep), plus deciding how far it extends into `pages/api/*` and the shared fetch/hook layer (`use-http`-based hooks, `common.Recipe`-shaped API responses) so frontend types can eventually be checked against what the Go API actually returns.
