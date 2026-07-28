# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

31. **Buying preference: prefer fresh fruit over bottled juice.** For when automated
    buying exists. A Recipe asking for lemon juice, lime juice or orange juice should be
    satisfiable by buying the fruit rather than a bottle, as a user-level preference
    rather than a hard rule.

    The catalog already models most of what this needs, which is why it is worth writing
    down now rather than discovering later. `lemon juice` has a Base Unit of millilitre,
    and a Unit Size on a whole `lemon` records how much juice one fruit yields — that is
    the same mechanism that lets "3 onions" combine with "150g onion" (see CONTEXT.md's
    Unit Size). So the conversion "45ml lemon juice" -> "1 lemon" is already expressible;
    what is missing is a link saying *this Ingredient can be produced from that one*, and
    a preference saying which side to buy.

    Deliberately not a merge. `lemon` and `lemon juice` are different Ingredients and
    should stay so — the recipe genuinely wants juice, and a shopper buying for a recipe
    that needs lemon zest as well needs the fruit. The preference belongs at buying time,
    where it can be turned off, not baked into the catalog where it cannot.

    Worth checking when this is picked up: whether the yield Unit Sizes actually exist on
    `lemon`, `lime` and `orange` yet, since `030` merged `freshly squeezed lemon juice`
    into `lemon juice` but did not add any.

32. **`react-hooks/set-state-in-effect` is switched off, and shouldn't stay that way.**
    Added while upgrading to Next.js 16. `eslint-config-next@16` pulls in
    `eslint-plugin-react-hooks` 7.1.1; the rule was introduced in that plugin's v6
    and fires on 10 pre-existing call sites, so the upgrade turned it off in
    `eslint.config.mjs` rather than refactor working code inside a version bump.

    The call sites, roughly in increasing order of risk to touch:
    `hooks/use-viewport.ts:7` and `hooks/use-page-visibility.ts:13` (both the standard
    subscribe-to-an-external-system-on-mount shape, and the most likely to be
    straightforwardly fixable or legitimately exempt); `pages/account.tsx:32`;
    `pages/recipes/[id]/index.tsx:28` (the "Recipe saved" toast);
    `pages/list.tsx:201-202`; `pages/recipes/new.tsx:186` (the Recipe Import job-polling
    loop); and `components/recipe-form/Form.tsx:153,161,213`.

    The last two are the ones to be careful with — `Form.tsx` is the hottest file in the
    repo, and `new.tsx`'s polling effect is what the Photo Import path runs on. Both are
    covered by `e2e/recipe-import.spec.ts`, so there is a real safety net, but neither is
    a mechanical fix: the rule is pointing at cascading-render behaviour, and changing
    when those `setState` calls fire changes what renders.

    Worth doing per-file rather than as one sweep, re-enabling the rule only once every
    site is clean.

33. **`e2e/` is excluded from linting and should get its own config block.** Added while
    upgrading to Next.js 16. `next lint` only ever covered `pages/`, `components/` and
    `lib/`, so `e2e/` was never linted; switching to `eslint .` would have brought it in
    for the first time, and it fails immediately on a false positive rather than a real
    defect.

    The cause is a name collision, not a bug: a Playwright fixture is written
    `async ({ page }, use) => { await use(...) }`, and `eslint-plugin-react-hooks` reads
    that as calling a hook named `use` from a non-component function named `page`. It is
    the React 19 `use` hook's name, in a file that has nothing to do with React.

    The fix is a scoped config block for `e2e/**` that turns the React rules off entirely
    (they cannot apply — there are no components there) while keeping the general
    JavaScript/TypeScript rules, rather than the blanket `ignores` entry the upgrade used
    to avoid expanding scope mid-version-bump. `e2e/` has its own `tsconfig.json`
    already, so the precedent for treating it as a separate project exists.

34. **`swagger-ui-react` logs a non-fatal TypeError under Turbopack.** Found while
    upgrading to Next.js 16, which makes Turbopack the default bundler. Only affects
    `/dev/api-docs`.

    The page renders correctly — all 23 operations and 8 tag sections, no error banner —
    but the browser console carries two copies of:

    ```
    OpenApi3_1Element.refract is not a function
      at Object.normalize (node_modules_swagger-client_es_...)
      at resolveSubtree (...)
    ```

    Confirmed Turbopack-specific by running the same page on the same commit under both
    bundlers: `next dev` (Turbopack) gives 2 console errors and 23 operation blocks;
    `next dev --webpack` gives 0 console errors and the same 23 blocks. So it is a
    bundler interop problem with `@swagger-api/apidom-ns-openapi-3-1`'s `.mjs` sources,
    not a regression in the spec, the page, or `swagger-ui-react`'s version.

    Left alone deliberately. `pages/dev/api-docs.tsx` is dev-only — its
    `getServerSideProps` returns `notFound` outside development — so this never reaches
    production, and the failing code path is `$ref` resolution the Big Shop spec does not
    depend on. Worth revisiting if the viewer ever starts rendering incompletely, or if
    `swagger-ui-react` is upgraded and the error changes shape.

35. **`swagger-ui-react` declares peer dependencies incompatible with React 19.** Found
    while upgrading to React 19. `npm ls` reports three of its nested dependencies as
    `invalid`:

    ```
    react-copy-to-clipboard  peer react "^15.3.0 || 16 || 17 || 18"
    react-debounce-input     peer react "^15.3.0 || 16 || 17 || 18"
    react-inspector          peer react "^16.8.4 || ^17.0.0 || ^18.0.0"
    ```

    `swagger-ui-react` itself is fine (`>=16.8.0 <20`) — it is only these transitive
    packages. Nothing in the app's own dependency set is invalid.

    No actual breakage. `/dev/api-docs` renders identically before and after the React 19
    bump: 23 operation blocks, 8 tag sections, zero page errors, and the same two
    pre-existing Turbopack console errors tracked in #34. The unsupported components are
    the copy-to-clipboard button and the debounced filter input, neither of which this
    viewer depends on.

    Left as-is because it is noise rather than a defect, and only on a dev-only page
    (`pages/dev/api-docs.tsx` returns `notFound` outside development). Worth revisiting if
    `npm ci` is ever run with `--strict-peer-deps`, if a future npm makes invalid peers a
    hard install failure, or if the viewer starts misbehaving. The real fix is upstream in
    `swagger-ui-react`.
