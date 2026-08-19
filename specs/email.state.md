---
spec: specs/email.md
status: in-progress
branch: implement/email
pr:
---

Scope of this run: **Phase 1a–1d only**. Phase 2 (transactional) needs Auth0 dashboard
access and #59/#46 to merge; it gets a `backlog` board row rather than a Session here.

Three decisions taken at planning time, recorded because they are not in the spec:

- **No launch cutoff constant.** A one-row `email_launch` marker table, stamped
  `CURRENT_TIMESTAMP` by its own migration, is joined into the due-query instead. No date
  to hand-pick; new signups are in from the moment this ships; the existing user base is
  still excluded. Deliberately *not* done by backfilling `email_send` rows for existing
  users — a row there means "handed to SendGrid", and writing one for an email never sent
  makes the log lie.
- **Day 8 is inspiration, not a CTA.** Three recipes in the template body, in one
  easily-swapped slice. The add-from-email mechanism goes to a new board row.
- **The ASM group is set per-send, not globally.** Lifecycle sends set it; the invite
  does not, because transactional email is not unsubscribable (ADR-0010).

## Session 1: Phase 1a — the sending seam
Status: done
Scope: `internal/pkg/service/email` package; go:embed layout partial + golden-file test; clean no-op when `SENDGRID_API_KEY` is unset; sender centralised as `hello@bigshop.life`; `inviteUser`'s inline send ported onto it with behaviour unchanged.
Depends on: none
Commit: 271ea40 (+ review fixes)
Notes:
- Go tests green; `POST /invite` exercised against the local stack and now answers **204** where it previously answered 400 on every call, with the clean skip logged. No OpenAPI drift.
- **Deviation from the spec's stated signature.** Phase 1a asks for "one `Send(ctx, to, subject, template, data)` entry point". Shipped as two — `SendLifecycle` and `SendTransactional` — which is the mechanical consequence of the ASM decision above: with one entry point there is a path that sends onboarding email without an unsubscribe, and with two there is not. The `sent bool` is load-bearing: Session 3 uses it to decide whether to write `email_send`.
- The dead `pleeyu7yrd.execute-api...` invite URL and the 400-on-send-failure are deliberately untouched; both are #46's.
- Review findings fixed: the unconfigured skip now happens **before** rendering (a template error could otherwise 400 `POST /invite` on a machine with no key); `SENDGRID_ASM_GROUP_ID` rejects non-positive and non-numeric values instead of forwarding them; `sendGridBaseURL` is injectable so the non-2xx branch is actually tested; the unconfigured-state logs fire once per process, not once per send, because Session 3's ticker would otherwise write a line per due user per hour forever.
- Review finding fixed: `utm_source`/`utm_medium=lifecycle` had been put on the **shared layout**, so the transactional invite carried them too. Removed — campaign tagging is per-template and belongs to Session 4's lifecycle emails only.
- `SITE_URL`, `SENDGRID_API_KEY` and `SENDGRID_ASM_GROUP_ID` documented in `technical-architecture.md`.
- **Declined:** the reviewer's Data Clump call on `(to, subject, template, data)` threading through the send path. Four parameters across two thin wrappers does not yet justify a Message type, and the two-door API is the property worth keeping.

## Session 2: Phase 1b — timezone capture
Status: pending
Scope: migration `035_user_timezone.sql`; `common.User.Timezone` with `omitempty`; `service.AddUser` insert-only (omitted from `ON DUPLICATE KEY UPDATE`); `pages/index.tsx` adds `Intl.DateTimeFormat().resolvedOptions().timeZone` to the existing `POST /user` payload.
Depends on: none (independent of Session 1, ordered first because Session 3 reads the column)
Commit:
Notes:
- **Partly started.** `migrations/035_user_timezone.sql` is already written and committed (it rode along in b13aea5, ahead of its session — it is a new file and conflicts with nothing). Its syntax was applied by hand against the local DB and the column is correct: `timezone varchar(64) NULL`. Everything else in this session is still to do.
- Still to do: `common.User.Timezone` with `omitempty`; `service.AddUser` writing it on insert and **omitting it from `ON DUPLICATE KEY UPDATE`**; `pages/index.tsx` adding `Intl.DateTimeFormat().resolvedOptions().timeZone` to the existing `POST /user` payload.
- Must regenerate BOTH drift-checked artefacts or CI's `go` job fails — `go run . openapi > ../../docs/openapi.yaml`, then `npm run generate:api-types`.
- Local stack for this worktree: `COMPOSE_PROJECT_NAME=bigshop-impl50 DB_PORT=3320 API_PORT=8083 GRAFANA_PORT=3220 OTLP_HTTP_PORT=4328 docker compose up -d db api`. Go runs inside `bigshop-impl50-api-1` (there is no Go toolchain on the host). Tear down with the same project name and `down -v` — a plain `docker compose down` would hit another worktree's stack.

## Session 3: Phase 1c — the ticker and the send log
Status: pending
Scope: migration `036_email_send.sql` (`email_send` + the `email_launch` marker); hourly `time.Ticker` started from `isServeMode()` only; the due-query (`>=` on days-since-signup, rows on success only); the one-email-per-user-per-tick guard; 10:00 local with `Europe/London` fallback; Go tests across timezone/DST/launch-marker boundaries.
Depends on: Session 2 (reads `user.timezone`)
Commit:
Notes: Proven with a stub sender, no templates. The per-tick guard is not optional — without it a week-long outage sends three emails within a second, which is the likeliest spam report this design has.

## Session 4: Phase 1d — the four emails
Status: pending
Scope: four `html/template` files with the non-promotional constraint stated in each; `utm_*` links carrying no identifier; the welcome email's inline fire-and-forget send in `addUser`; the `preview` and `send-test` modes (spec, "Trying it out before trusting it"); `/privacy` updated for the lifecycle family, its lawful basis, `user.timezone`, and the permanent suppression list.
Depends on: Sessions 1 and 3
Commit:
Notes:
- The welcome send must never fail `POST /user` — that is exactly the mistake `POST /invite` makes today. It still writes `email_send`, so a failure retries on the next tick.
- `send-test` is a subcommand on `os.Args[1]`, not an HTTP route: a route that mails an address from its request body is an open relay. Like `openapi` mode it returns before the DB is opened. **It must never write an `email_send` row** — doing so would mean a real user silently never receives the email being tested.
- The external setup is now real: SendGrid account live, key set via `fly secrets` *and* declared in `machine_config.json`, domain authenticated, `hello@bigshop.life` verified and monitored, ASM group **32124** set in `fly.toml`'s `[env]`. So `SendLifecycle` will genuinely send once this merges — the `email_launch` marker from Session 3 is the only thing keeping the existing user base out of it.
