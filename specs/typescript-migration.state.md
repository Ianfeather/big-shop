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
Status: pending
Scope: convert 8 hook files + 6 test files to .ts; type use-recipes.ts/use-recipe.ts against generated RecipeSummary/Recipe.
Depends on: Session 1

## Session 3: components/
Status: pending
Scope: convert all 16 component directories to .tsx (+ .test.tsx); explicit prop interfaces.
Depends on: Session 2

## Session 4: pages/ + pages/api/*
Status: pending
Scope: convert remaining pages/*.js and pages/api/*.js/.mjs to .ts/.tsx; remove dead jsx-in-js vitest plugin; confirm allowJs false.
Depends on: Session 3
