---
spec: specs/email.md
status: planned
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
Status: pending
Scope: `internal/pkg/service/email` package with `Send(ctx, to, subject, template, data) (sent bool, err error)`; go:embed layout partial + golden-file test; clean no-op when `SENDGRID_API_KEY` is unset; sender centralised as `hello@bigshop.life`; `inviteUser`'s inline send ported onto it with behaviour unchanged.
Depends on: none
Commit:
Notes: The `sent bool` is load-bearing — Session 3 uses it to decide whether to write `email_send`. Do NOT fix the dead `pleeyu7yrd.execute-api...` invite URL or the 400-on-send-failure; both are #46's.

## Session 2: Phase 1b — timezone capture
Status: pending
Scope: migration `035_user_timezone.sql`; `common.User.Timezone` with `omitempty`; `service.AddUser` insert-only (omitted from `ON DUPLICATE KEY UPDATE`); `pages/index.tsx` adds `Intl.DateTimeFormat().resolvedOptions().timeZone` to the existing `POST /user` payload.
Depends on: none (independent of Session 1, ordered first because Session 3 reads the column)
Commit:
Notes: Must regenerate BOTH drift-checked artefacts or CI's `go` job fails — `go run . openapi > ../../docs/openapi.yaml`, then `npm run generate:api-types`.

## Session 3: Phase 1c — the ticker and the send log
Status: pending
Scope: migration `036_email_send.sql` (`email_send` + the `email_launch` marker); hourly `time.Ticker` started from `isServeMode()` only; the due-query (`>=` on days-since-signup, rows on success only); the one-email-per-user-per-tick guard; 10:00 local with `Europe/London` fallback; Go tests across timezone/DST/launch-marker boundaries.
Depends on: Session 2 (reads `user.timezone`)
Commit:
Notes: Proven with a stub sender, no templates. The per-tick guard is not optional — without it a week-long outage sends three emails within a second, which is the likeliest spam report this design has.

## Session 4: Phase 1d — the four emails
Status: pending
Scope: four `html/template` files with the non-promotional constraint stated in each; `utm_*` links carrying no identifier; the welcome email's inline fire-and-forget send in `addUser`; a dev-only preview route; `/privacy` updated for the lifecycle family, its lawful basis, `user.timezone`, and the permanent suppression list.
Depends on: Sessions 1 and 3
Commit:
Notes: The welcome send must never fail `POST /user` — that is exactly the mistake `POST /invite` makes today. It still writes `email_send`, so a failure retries on the next tick.
