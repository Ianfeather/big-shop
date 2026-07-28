# Known issues

Defects that are real, understood, and **deliberately not being fixed**. Unlike
[`follow-ups.md`](./follow-ups.md), nothing here is queued work — each entry has been
investigated, judged not worth acting on, and written down so the next person to hit it
does not re-investigate it. Every item records what would change that judgement.

Numbering is continuous with `follow-ups.md` (items 34 and 35 originated there), so
existing cross-references in `specs/` still resolve.

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
