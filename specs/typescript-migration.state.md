---
spec: specs/typescript-migration.md
status: planned
branch: implement/typescript-migration
pr:
---

## Session 1: Tooling, config, and codegen
Status: pending
Scope: typescript + @types/* + openapi-typescript devDeps; tsconfig.json; delete jsconfig.json; .gitignore next-env.d.ts; npm scripts (typecheck, generate:api-types, package); generate+commit types/api.d.ts; extend build.sh drift check; types/swagger-ui-react.d.ts shim. No source conversions.
Depends on: none

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
