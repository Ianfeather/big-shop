---
spec: specs/typescript-migration.md
status: in-progress
branch: implement/typescript-migration
pr:
---

## Session 1: Tooling, config, and codegen
Status: done
Scope: typescript + @types/* + openapi-typescript devDeps; tsconfig.json; delete jsconfig.json; .gitignore next-env.d.ts; npm scripts (typecheck, generate:api-types, package); generate+commit types/api.d.ts; extend build.sh drift check; types/swagger-ui-react.d.ts shim. No source conversions.
Depends on: none
Commit: 3cc29b2 (fixes on top of 90449e8)
Notes: Test gate green (tsc --noEmit clean, npm run test 94/94, npm run build clean). Note: @types/react/@types/react-dom had to be pinned to ^18 (npm resolved ^19 by default, mismatching the installed react@18.2.0); typescript pinned to ^5 (openapi-typescript@7.13.0 peer-depends on typescript ^5.x, conflicts with the ^7 npm resolved by default). Review gate: Standards + Spec sub-agents both flagged the same CONFIRMED issue (tsconfig `include` used the unscoped create-next-app default instead of being scoped to pages/components/hooks/types per spec) plus a stale CLAUDE.md doc and a minor build.sh duplication smell — all three fixed in 3cc29b2. `go` isn't installed locally so the Go/drift portions of build.sh couldn't be run end-to-end here (matches CLAUDE.md's documented local limitation); the new types/api.d.ts drift-check line was verified in isolation instead.

## Session 2: hooks/
Status: done
Scope: convert 8 hook files + 6 test files to .ts; type use-recipes.ts/use-recipe.ts against generated RecipeSummary/Recipe.
Depends on: Session 1
Commit: 59b6eef (fix on top of 5a0dd41)
Notes: Test gate green (tsc --noEmit clean, npm run test 94/94, lint clean, build clean). Supporting changes beyond the 8 hooks, needed to make this compile: added types/models.ts (hand-written named aliases over generated types/api.d.ts — spec review flagged this as not literally named in the spec, which only says "type against RecipeSummary/Recipe from types/api.d.ts"; kept deliberately as a low-risk, low-noise convenience layer rather than repeating components['schemas']['X'] indexing at every call site — judgment call, not reverted); converted mocks/index.js -> .ts (code wrapper, not data — required for resolveJsonModule inference to reach through it since allowJs is false); added types/testing-library-jest-dom.d.ts (ambient reference for jest-dom's Vitest matcher types, since vitest.setup.js is plain .js and outside tsconfig's include); vitest.config.js gained esbuild.jsx:'automatic' (native .tsx handling was falling back to esbuild's classic transform, needing React in scope — use-overflow.test.tsx is the first .tsx file in the repo). use-http's cachePolicy is a real enum (CachePolicies.NO_CACHE), not a string literal union. use-ingredient-metadata.ts split one useFetch() into two typed instances (use-http's TData is fixed per instance); review flagged this as an untested but correct behavior improvement (previously response.ok reflected whichever of two concurrent requests resolved last) — not covered by a new test since no hook test in this repo exercises the real-fetch (non-mock) branch, consistent with existing convention. Review gate: Standards sub-agent flagged use-auth.ts's original `as typeof useMockAuth0` cast as an unchecked assertion — fixed in 59b6eef by declaring an explicit UseAuthResult interface and typing the ternary against it, so both branches are checked assignments instead of a blind cast.

## Session 3: components/
Status: pending
Scope: convert all 16 component directories to .tsx (+ .test.tsx); explicit prop interfaces.
Depends on: Session 2

## Session 4: pages/ + pages/api/*
Status: pending
Scope: convert remaining pages/*.js and pages/api/*.js/.mjs to .ts/.tsx; remove dead jsx-in-js vitest plugin; confirm allowJs false.
Depends on: Session 3
