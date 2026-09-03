---
spec: specs/completed/account-linking-recovery.md
status: complete
branch: implement/account-linking-recovery
pr: https://github.com/Ianfeather/big-shop/pull/157
---

Branched from `spec/account-linking-recovery` (PR #156, which carries the spec
itself), so the implementation PR is stacked on it rather than duplicating the
spec commits into a master-based branch.

The run was asked to proceed without stopping for questions, so step 2's
plan-mode sign-off was skipped deliberately; the Session breakdown below simply
follows the spec's own "Implementation sequence" phases, which is what step 2
asks for first anyway.

## Session 1: The resolved flag (Phase 0)
Status: done
Scope: Widen `useRecipes` to report whether its query has resolved
  (`return [data ?? [], isSuccess] as const`). Purely additive; no call-site
  changes. Done when a test proves an unresolved query is distinguishable from
  an empty one.
Depends on: none
Commit: 0895aaa
Notes: `npm run typecheck`, `npm run lint` and the full Vitest suite (54 files,
  423 tests) all green. Two new tests in hooks/use-recipes.test.ts pin that an
  in-flight query and an empty result are distinguishable. Code review deferred
  into Session 2's pass - the whole change is one returned tuple element plus
  its tests, and the code-review skill spawns two sub-agents.

## Session 2: The server, with no UI (Phase 1)
Status: done
Scope: `migrations/046_pending_link.sql`; `service/link.go` holding
  `StartLink` / `CompleteLink` and the narrow cascade entry point that runs
  `deleteAccountTx` (never `DeleteUserAndAccount`); `POST /link/start` and
  `POST /link/complete` in `app/link.go`; regenerated `docs/openapi.yaml` and
  `types/api.d.ts`. Tests cover: a token bound to a different subject is
  refused; an expired token is refused; a missing or wrong nonce is refused; a
  source account holding recipes is refused; a successful link leaves no
  orphaned `account` row.
Depends on: none
Commit: e8907c7
Notes: gofmt/vet clean; `go test ./... -race` green; `docs/openapi.yaml` and
  `types/api.d.ts` regenerated and byte-identical to their generators. Verified
  against a real MySQL as well as in unit tests - migration applies and the
  container reports healthy; wrong nonce, unknown token and a repeat of the
  caller's own provider each refused with their own status; the happy path
  links the subject, leaves no orphaned `account` row, consumes the token
  (replay refused) and leaves the surviving recipes intact; a source account
  holding a recipe is refused with the source untouched and its token still
  redeemable.

  Code review (both axes) run at this point and covering Session 1 too. Fixed:
  (1) an expiry bug the reviewer found and the tests could not - CompleteLink
  purged expired rows *before* reading the token, so an expired request came
  back as "no longer valid" rather than "expired, start again"; the purge now
  runs on the write path only, and purgeExpiredLinks says why; (2) StartLink's
  clear-then-insert is now one transaction, so a failed insert cannot leave
  somebody with neither their old attempt nor a new one; (3) the missing
  done-when test for "a token bound to a different subject is refused", added
  as TestCompleteLinkGrantsOnlyTheTokensOwnSubject with a note on what that
  bullet can mean, since its literal reading is the flow's own happy path;
  (4) `pending_link.subject` renamed `granted_subject`, which retires a
  paragraph of migration prose apologising for the name; (5) checkLink now
  takes a `pendingLink` struct so the two subjects cannot be transposed;
  (6) `technical-architecture.md`'s table list gained `pending_link` (and
  `user_identity`, which #154 had left out).

  Declined, deliberately: extracting a shared `purgeExpired(table, ...)` from
  the invite and link versions - the shared shape is four tokens of SQL and the
  generic form takes a table name as a string to interpolate, which is a worse
  thing to have than a duplicated DELETE. Also declined: a `Subject` string
  type across the codebase (the transposition risk it addresses is closed by
  the struct above), and de-duplicating the prose that argues the nonce in five
  places - this repo's standard rewards the argument being where the reader is.
  The spec's "narrow exported entry point" for `deleteAccountTx` is not built:
  the erase and the grant have to be one transaction, so the caller lives in
  the same package and needs no export. The rule the export existed to enforce
  is written down in `applyLink` instead.

## Session 3: The flow (Phase 2)
Status: done
Scope: `pages/link/confirm.tsx`, the `prompt=login` redirect, the localStorage
  nonce, the confirmation copy, and the `/link/confirm` entry in
  `lib/analytics/page-titles.ts` (without which the route test fails).
Depends on: Session 2
Commit: 2d343cb
Notes: Typecheck, lint and the full Vitest suite green, with 14 new tests for
  the nonce and the stored pending link. Verified in a browser against the real
  stack: the "nothing to link" state, the confirmation naming the provider, and
  a refusal rendering its advice while leaving the request retryable.
  Screenshots in specs/evidence/account-linking-recovery/.

  Two judgement calls worth review. (1) The Auth0 callback still lands on
  `/list` and `lib/return-to.ts` forwards to `/link/confirm`, rather than
  `/link/confirm` becoming an Allowed Callback URL in the tenant: the latter
  needs a tenant change per origin (deploy previews included, where it would
  fail silently at the last step) and would put a second owner on the one
  post-login navigation `pages/_app.tsx` deliberately owns alone. The spec's
  step 5 - "return to /link/confirm" - is still what happens. **No Auth0
  configuration change is needed to ship this.** (2) With auth disabled the
  mock `loginWithRedirect` is a no-op, so the hook navigates straight to
  `/link/confirm`; that keeps the screen reachable locally and in e2e, where it
  refuses correctly because signing in "again" yields the same subject.

## Session 4: The surface (Phase 3)
Status: done
Scope: The `/list` panel behind the resolved-and-empty condition, and the
  `/account` entry point. `/recipes` deliberately untouched.
Depends on: Sessions 1 and 3
Commit: 80434fb
Notes: Typecheck, lint and 438 Vitest tests green. Verified in a browser
  against the real stack, including the negative case: with two seeded recipes
  the panel is absent; with none it appears; and after a successful link it
  disappears again. The whole loop was then driven through the UI with a real
  second identity (`apple|relay9`, an empty account) - clicking the panel
  started the link and stored the nonce, the confirmation named the Apple
  sign-in, and completing it aliased that subject to the original user, removed
  the abandoned `account` row and left the surviving recipe reachable from
  *both* sign-ins. Screenshots of all four states in
  specs/evidence/account-linking-recovery/.

  One change beyond the panel itself: `components/shopping-list/ShoppingList`
  gained an optional `notice` slot. It owns the PageHeading, so anything the
  page stacked above it sat above the page's own title and read as a layout
  mistake. A slot rather than a `showAccountLinkPrompt` boolean - what goes
  there is the page's business.

## Session 5: The notification (Phase 4)
Status: done
Scope: A new `email.Kind` and template telling the original account's address
  that a new sign-in method was added — best-effort and asynchronous, carrying
  no grant.
Depends on: Session 2
Commit: d750f08
Notes: gofmt/vet clean and `go test ./... -race` green. Two golden files - the
  named-provider case and the one where service.ProviderName has no name for
  the connection, so the fallback sentence is reviewed rather than assumed, for
  the same reason `welcome-no-name` exists. `TestEveryRegisteredEmailRenders`
  caught the new Kind before it could ship without sample data, which is
  exactly what it is for; `preview.go`'s transactionalSample gained a case so
  `go run . preview` renders it too. The rendered email is screenshotted in
  specs/evidence/account-linking-recovery/sign-in-added-email.png, taken from
  that preview server - no unsubscribe footer (transactional, per ADR-0010) and
  no link or token anywhere in the body.

## Review round two, and one thing the spec asks for that this run could not do

`/code-review` was run a second time over Sessions 3-5. Fixed:

- **The journey could strand somebody, on exactly the platforms the spec worried
  about.** The nonce is in localStorage so it survives an installed PWA being
  resumed or a native wrapper deep-linking back; the *navigation* to
  `/link/confirm` rode `lib/return-to.ts`, which is sessionStorage. So on those
  platforms the nonce would survive and the navigation would not - and the
  person would land on `/list` signed in as the account that *has* recipes, so
  the panel was suppressed and nothing pointed at the link they were halfway
  through. `lib/account-link.ts`'s `accountLinkOffer` now returns `finish`
  whenever a link is pending, whatever the recipe count, and the panel offers
  "Finish linking". The return-to is a convenience again rather than the only
  thread holding the journey together.
- **The email now says *when*.** The spec asks for "which one, when, and the
  support address"; it had the first and third. UTC with the zone named, not
  localised - `user.timezone` exists but GetUser deliberately does not return
  it, and a wrong local time is worse than an honest UTC one on the one line
  somebody checks against their own memory.
- **The condition that must not flash is now tested.** It was the most laboured
  requirement in the spec and asserted nowhere; `accountLinkOffer` and
  `linkRefusalMessage` moved into `lib/account-link.ts` so they could be, and
  `hooks/use-account-link.test.ts` covers the ordering that actually carries
  weight - the nonce is stored *before* any navigation, and cleared only on
  success. That ordering test was mutation-checked: reversing the two lines
  turns it red.
- Undefined CSS custom properties (`--color-border`, `--color-text-muted`) that
  always fell through to hardcoded hex, replaced with the real tokens `--rule`
  and `--ink-soft`, plus `--space-*` / `--radius-md`; both new inline error
  paragraphs replaced by `components/message`, which gained `role="alert"`;
  an unused `style` prop removed; the repeated four-deep layout wrapper in
  `confirm.tsx` extracted; `useStartAccountLink` made a named export to match
  its sibling; a stale "three of the four" comment corrected.

**Phase 2's done-when is NOT met, and that is worth saying plainly rather than
in a footnote.** The spec says "Done when the whole path works end to end
against a real tenant with two providers." Everything here was verified under
`DISABLE_AUTH` against a real MySQL, including a genuine second identity with
its own empty account - so the token, the nonce, the refusals, the cascade and
the grant are all exercised for real. What is *not* exercised is the Auth0 round
trip itself: the `prompt=login` redirect and the callback. That needs tenant
credentials this run did not have, and it is the one part of the flow no test
here covers. Somebody should walk it once on a deploy preview with two
providers before this is trusted in production.
