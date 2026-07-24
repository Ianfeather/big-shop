# Convert the frontend to TypeScript

## Current state (why this isn't greenfield)

`follow-ups.md` item 9: `pages/`, `components/`, and `hooks/` are all plain `.js` today — no compile-time type checking exists anywhere on the frontend. There's already a `jsconfig.json` with path aliases (`@components/*`, `@hooks/*`) but no `tsconfig.json` and no `.ts`/`.tsx` files anywhere in the repo.

The Go API's OpenAPI spec is already committed and kept honest: `docs/openapi.yaml` is generated from `internal/pkg/app/app.go` via Huma, and `build.sh` fails the build if it drifts from that source. This gives the migration a real source of truth for API response shapes (`Recipe`, `Account`, `ShoppingList`, etc.) to generate frontend types from, rather than hand-writing them.

`vitest.config.js` has a custom `jsx-in-js` esbuild plugin solely because JSX currently lives in plain `.js` files, which neither Vite's default esbuild handling nor `@vitejs/plugin-react` treats as JSX by extension. `.tsx` files don't need this — esbuild's loader is extension-driven, so once a file is renamed `.tsx` it's handled automatically.

The design/decision work for this migration was done via a grilling session and is recorded in [ADR-0002](../docs/adr/0002-typescript-migration.md) — this spec turns that decision into an ordered, sessionable execution plan. **Do not re-derive the strategy below; it's already decided.**

## Proposed approach

### Phase 1 — Tooling, config, and codegen

- Add devDependencies: `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `openapi-typescript`.
- Add `tsconfig.json`: `strict: true`, `resolveJsonModule: true`, `jsx: "preserve"`, `baseUrl: "./"` with `paths` carrying over `jsconfig.json`'s `@components/*`/`@hooks/*` aliases, `include` scoped to `pages/`, `components/`, `hooks/`, `types/` (not root config files like `next.config.js`/`vitest.config.js`/`evals/*`, which stay plain `.js` and are Node-loaded directly, not part of the Next.js TS project). Delete `jsconfig.json` — superseded.
- `next dev`/`next build` auto-generates `next-env.d.ts` on first run; add it to `.gitignore` (matching Next.js's own convention) rather than committing it.
- Add npm scripts: `"typecheck": "tsc --noEmit"` and `"generate:api-types": "openapi-typescript docs/openapi.yaml -o types/api.d.ts"`. Update `"package"` (Netlify's actual deploy build command per `CLAUDE.md`) to `"lint && typecheck && build"` — this is how the ADR's "blocking check in build.sh" requirement is satisfied, since `build.sh` already calls `npm run package`.
- Generate and commit `types/api.d.ts` (`npm run generate:api-types`). Extend `build.sh`'s existing `docs/openapi.yaml` drift check with an equivalent diff check for `types/api.d.ts` against a fresh `openapi-typescript` run, same pattern (`diff -u types/api.d.ts <(openapi-typescript docs/openapi.yaml)`, fail with regen instructions on mismatch).
- Add `types/swagger-ui-react.d.ts` — local ambient module shim (typed `ComponentType` props, not bare `any`) per ADR-0002.
- No source files convert in this phase. `allowJs` stays unset/`false` in `tsconfig.json` from the start — this is safe even with `.js` files still present elsewhere in the repo during later phases, since anything not in `include` (or not `.ts`/`.tsx`) is simply invisible to `tsc`, not an error. Next.js's own bundler continues compiling remaining `.js` files as plain JS regardless.

### Phase 2 — `hooks/`

Convert all 8 hook files and their 6 `.test.js` files to `.ts`/`.test.ts` (none render JSX directly, so no `.tsx` needed here): `use-auth`, `use-ingredient-metadata`, `use-interval`, `use-overflow`, `use-page-visibility`, `use-recipe`, `use-recipes`, `use-viewport`.

- `use-recipes.ts` / `use-recipe.ts`: type the `useFetch` calls against `RecipeSummary`/`Recipe` from `types/api.d.ts` (`use-http` ships its own generics-supporting types, no shim needed). The mocks-path narrowing in `use-recipes.ts` (`.map(({id, name, tags}) => ({id, name, tags}))`) and the full-shape usage in `use-recipe.ts` both rely on `resolveJsonModule` structural inference of `mocks/recipes.json` — per ADR-0002, `mocks/*.json` itself does **not** get converted or annotated.

### Phase 3 — `components/`

Convert all 16 component directories (`button`, `dave-chat`, `identity`, `invite`, `layout`, `message`, `recipe`, `recipe-form`, `recipe-list`, `shopping-list`, `sidebar-heading`, `sidebar-input`, `sidebar-item`, `sidebar-tag-filter`, `svg`, `tag-pill`, `user-menu`) to `.tsx`, plus their `.test.js` files to `.test.tsx`. CSS modules (`*.module.css`) are untouched. Add explicit prop types per component (interfaces, not inferred `any`), importing from `types/api.d.ts` wherever a component's props are API-response-shaped (e.g. a `Recipe`).

### Phase 4 — `pages/` + `pages/api/*`

Convert every remaining `.js`/`.mjs` file to `.tsx`/`.ts`:
- `pages/`: `_app.js`, `account.js`, `dave.js`, `index.js`, `list.js`, `recipes/index.js`, `recipes/new.js`, `recipes/[id]/index.js`, `recipes/[id]/edit.js`, `dev/api-docs.js`, `dev/design-system.js`.
- `pages/api/`: `dave/chat.js` (+ `.test.js`), `dave/tools.js` (+ `.test.js`), `dev/openapi-spec.js`, `parse-recipe-text.js` (+ `.test.js`), `parse-recipe-url.js` (+ `.test.js`), `recipe-image.mjs` → `recipe-image.ts`.

Cleanup once nothing `.js`/`.mjs` remains in the converted scope:
- Remove `vitest.config.js`'s `jsx-in-js` custom plugin — it only ever patched `.js` files; with none left in scope, it's dead code (Vite's built-in esbuild handling already covers `.tsx` by extension).
- Confirm `tsconfig.json`'s `include` covers the full converted tree and `allowJs` is `false`.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

Full rationale in [ADR-0002](../docs/adr/0002-typescript-migration.md). Summary:

- **Strategy**: one bounded full sweep (this spec's 4 phases), not incremental `allowJs`/`checkJs` adoption. `strict: true` from Phase 1, not a later tightening pass.
- **Scope**: `pages/`, `components/`, `hooks/`, and `pages/api/*` including their tests. Root config files (`next.config.js`, `vitest.config.js`, `evals/*`, `scripts/*`) are out of scope.
- **API types**: generated by `openapi-typescript` from `docs/openapi.yaml` into committed `types/api.d.ts`, drift-checked in `build.sh` the same way `docs/openapi.yaml` itself already is — not hand-written.
- **Mocks**: `mocks/*.json` stays plain JSON; `resolveJsonModule` gives structural inference. Not rewritten as `.ts` or asserted against generated types.
- **Untyped dependency**: `swagger-ui-react` gets a local ambient shim at `types/swagger-ui-react.d.ts` rather than blocking the sweep.
- **Validation gate per session**: `tsc --noEmit` clean for that session's scope, plus `npm run test` passing (test files convert alongside the code they cover, so the existing Vitest suite keeps exercising runtime behavior throughout, not just static types).
