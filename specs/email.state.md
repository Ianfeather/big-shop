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
Status: done
Scope: migration `035_user_timezone.sql`; `common.User.Timezone` with `omitempty`; `service.AddUser` insert-only (omitted from `ON DUPLICATE KEY UPDATE`); `pages/index.tsx` adds `Intl.DateTimeFormat().resolvedOptions().timeZone` to the existing `POST /user` payload.
Depends on: none (independent of Session 1, ordered first because Session 3 reads the column)
Commit: 6377e51, migration in b13aea5, review fixes in bd3f426
Notes:
- Go suite, `typecheck`, `lint` and all 367 frontend tests green. Both drift-checked artefacts regenerated and re-verified clean; `timezone` is optional in each, which is what `omitempty` exists to guarantee.
- All three of the spec's *done when* clauses verified against the running stack: a genuinely new user records `Asia/Tokyo`; a second login claiming `Europe/Paris` with a new name updates the name and leaves the zone at `Asia/Tokyo`; a login sending no zone stores NULL.
- **A pre-existing user never acquires a zone**, by design — the first POST after the migration takes the UPDATE branch, which does not touch the column. Confirmed with the seeded `local-dev-user`. Those users fall back to Europe/London, and are excluded from the sequence anyway by Session 3's `email_launch` marker.
- Review fix: **an over-length `timezone` used to 500 `POST /user`**, and since `pages/index.tsx` swallows that, neither the User row nor their Account was created — a client-supplied string could break its own signup. `normaliseTimezone` now stores NULL for anything it cannot vouch for (too long, not a real IANA zone, empty, or `"Local"`, which resolves against the *server's* zone). Verified: a 200-char zone returns 200 with the account created.
- Review fix: **`GetUser` no longer selects the column.** It had no reader, and returning it put a location signal into every `GET`/`POST /user` body and the browser's query cache — against the spec's own "it goes no further than our database".
- Review fix: `userUpsert` is split out so the statement and args are testable without a DB. The insert-only rule lives entirely in one SQL statement's shape, so only a test can catch it being undone.
- **`_ "time/tzdata"` added to main.go.** `time.LoadLocation` is now load-bearing and the production image is distroless/static. Without the embedded database every zone fails to load, every user silently falls back to Europe/London, and no test catches it because tests run on an image that has tzdata. Session 3 depends on this.
- **e2e NOT yet run for this session.** It touches `pages/index.tsx`'s login path so it genuinely needs it, but worktree 2 had a live `bigshop-e2e` stack and `npm run test:e2e` starts by tearing those containers down. Must be run before the PR.
- Local stack for this worktree: `COMPOSE_PROJECT_NAME=bigshop-impl50 DB_PORT=3320 API_PORT=8083 GRAFANA_PORT=3220 OTLP_HTTP_PORT=4328 docker compose up -d db api`. Go runs inside `bigshop-impl50-api-1` (there is no Go toolchain on the host). Tear down with the same project name and `down -v` — a plain `docker compose down` would hit another worktree's stack.

## Session 3: Phase 1c — the ticker and the send log
Status: done
Scope: migration `036_email_send.sql` (`email_send` + the `email_launch` marker); hourly `time.Ticker` started from `isServeMode()` only; the due-query (`>=` on days-since-signup, rows on success only); the one-email-per-user-per-tick guard; 10:00 local with `Europe/London` fallback; Go tests across timezone/DST/launch-marker boundaries.
Depends on: Session 2 (reads `user.timezone`)
Commit: 0dc7652, migration in 6d14f89, review fix in 14371c7
Notes:
- New package `internal/pkg/lifecycle` (kinds + `due()` + `loadCandidates` + `Run`/`Start`), kept separate from `service/email` so every scheduling rule is a pure function testable with no DB and no network. 17 tests.
- **`migrations/036_email_send.sql`**: both guarantees demonstrated against a real MySQL rather than assumed — the composite PK rejects a duplicate `(user, kind)` while allowing a different kind for the same user, and `email_launch`'s CHECK genuinely refuses a second row.
- **The guard became one-per-DAY, not one-per-tick**, and only running it revealed why. `Start` ticks on boot as well as hourly, so a restart inside 10:00–10:59 puts two ticks in one send hour; against a real DB the same user got welcome at 10:30 and tips at 10:45, and a crash loop would march someone through the sequence in minutes. That is the burst the spec calls the likeliest route to a spam report. Both reviewers agreed it is a faithful strengthening.
- **`RecordSend` takes the instant** rather than using `DEFAULT CURRENT_TIMESTAMP`. It feeds the per-day guard and is compared against a Go-produced time; MySQL evaluates `CURRENT_TIMESTAMP` in the *server's* zone while the driver reads datetimes back as UTC, so a non-UTC server could shift a send across a local midnight.
- **Review fix (worst finding):** `daysSinceSignup` subtracted two instants as a `time.Duration`, which saturates at ±292 years. A zero `created_at` overflowed to −106751 days, read as "signed up in the future", and removed that user from the sequence **permanently and silently**. Now counted in Unix seconds.
- The due-test is deliberately **not** SQL, despite the spec sketching it that way: it needs `CONVERT_TZ`, which returns NULL unless the server's timezone tables are populated (never done on TiDB or in the e2e container), and the failure mode is a query that runs perfectly and matches nobody forever.
- **Known gap, carried forward:** `loadCandidates` and `Run` have no automated tests — the launch-cutoff SQL boundary, the per-user row folding that feeds `LastSentAt`, and `Run`'s "`sent == false` writes no row" branch. Both reviewers raised it; the `Sender` interface exists for exactly this and nothing uses it yet. All three were verified by hand against a real database (nothing at 09:30, one each at 10:30, nothing at 10:45, one per day after). **Do this in Session 4** by giving `Run` a store seam so its branches can be faked.
- Also noted: `user.created_at` still comes from MySQL's `CURRENT_TIMESTAMP` and carries the same theoretical clock skew `RecordSend` now avoids. Bounded — it needs a non-UTC DB server *and* a signup near local midnight to move a day bucket.
- The launch cutoff is an `email_launch` marker row stamped when the migration runs, not a hand-picked date constant. Rejected: backfilling `email_send` rows for existing users — a row there means "handed to SendGrid", so writing four per existing user would make the log begin its life lying.
- Proven with a stub sender, no templates. The per-tick guard is not optional — without it a week-long outage sends three emails within a second, which is the likeliest spam report this design has.
- `normaliseTimezone` in `service/user.go` already guarantees every stored zone is loadable by `time.LoadLocation`, so the sender's fallback is only for NULL, not for garbage.

## Session 4: Phase 1d — the four emails
Status: pending

**Carried in from Session 3's review:** give `Run` a store seam and test its branches (see Session 3's known gap above). This is the highest-value outstanding test work — `Run`'s `sent == false` branch is the only thing standing between an unconfigured environment and marking every user as already mailed.

**e2e is still owed** (from Session 2, which touched `pages/index.tsx`'s login path). It could not be run: worktree 2 has held a live `bigshop-e2e` stack throughout, and `e2e/env.ts` hardcodes `COMPOSE_PROJECT_NAME = 'bigshop-e2e'` with fixed ports, so there is no way to run an isolated copy without editing that file. Wait for their stack to clear, then `npm run test:e2e` before opening the PR.
Scope: four `html/template` files with the non-promotional constraint stated in each; `utm_*` links carrying no identifier; the welcome email's inline fire-and-forget send in `addUser`; the `preview` and `send-test` modes (spec, "Trying it out before trusting it"); `/privacy` updated for the lifecycle family, its lawful basis, `user.timezone`, and the permanent suppression list.
Depends on: Sessions 1 and 3
Commit:
Notes:
- The welcome send must never fail `POST /user` — that is exactly the mistake `POST /invite` makes today. It still writes `email_send`, so a failure retries on the next tick.
- `send-test` is a subcommand on `os.Args[1]`, not an HTTP route: a route that mails an address from its request body is an open relay. Like `openapi` mode it returns before the DB is opened. **It must never write an `email_send` row** — doing so would mean a real user silently never receives the email being tested.
- The external setup is now real: SendGrid account live, key set via `fly secrets` *and* declared in `machine_config.json`, domain authenticated, `hello@bigshop.life` verified and monitored, ASM group **32124** set in `fly.toml`'s `[env]`. So `SendLifecycle` will genuinely send once this merges — the `email_launch` marker from Session 3 is the only thing keeping the existing user base out of it.
