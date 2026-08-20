-- The onboarding email programme's two tables: what has been sent, and when the
-- programme started. See specs/completed/email.md.

-- One row per email actually handed to SendGrid.
--
-- **The composite primary key IS the idempotency guarantee**, and that is the
-- whole design rather than an index choice. A duplicate send is a primary key
-- violation instead of a second email in somebody's inbox, which is what makes
-- the hourly ticker safe to re-run by hand, safe across a deploy in the middle
-- of the send hour, and safe if Fly ever scaled the API to two machines. Nothing
-- else in the sequence has to be careful, because this cannot be got wrong.
--
-- **For the ticker, a row is written on success only**, and the due-query uses
-- `>=` on days-since-signup rather than `=`. Together those two choices are what
-- make the sequence self-heal: a failed send, an outage, or a deploy during the
-- send hour does not skip an email, it arrives on the next day's tick. An `=`
-- query would silently drop it forever, and nothing would report that it had.
--
-- **The welcome email is the exception: it claims its row *before* sending.**
-- It is sent inline on the request that creates the User, so unlike every other
-- email it has two possible writers - that request and the ticker. With both
-- sending first and recording second, the primary key above would protect the
-- log while two emails still reached the inbox. Claiming first makes the key
-- decide who sends; a failed send releases the claim so it is retried. See
-- lifecycle.ClaimSend and lifecycle.ReleaseSend.
--
-- **A row means "handed to SendGrid". Not "delivered", and not "read".**
-- Unsubscribes are suppressed by SendGrid after we make the call, so a logged
-- send may have been dropped on their side. That is stated rather than solved,
-- because solving it means holding unsubscribe state in this database - which is
-- exactly what specs/completed/email.md rejected, since these rows are inside the cascade
-- specs/account-deletion.md deletes, and an unsubscribe has to outlive the
-- Account.
--
-- No foreign key to `user`, and it is the one place this schema departs from its
-- neighbours (account_user, consent_event and invite all have one). The reason
-- is ordering rather than retention: the send log is written from a
-- fire-and-forget goroutine on signup, so it can race the row it would point at,
-- and a constraint would turn that race into a failed insert.
--
-- **These rows are deleted when an Account is erased**, explicitly, in
-- service.deleteAccountTx. The absence of a foreign key means nothing forces it,
-- which makes it easy to miss rather than optional: `user_id` is an Auth0
-- subject in plaintext, and specs/completed/account-deletion.md refuses to keep
-- one for somebody who has been told they were erased - it rejected a tombstone
-- `user` row for exactly that.
--
-- An earlier version of this comment argued the opposite, that retaining them
-- stopped "a deleted user who signs up again with the same address starting the
-- whole sequence over". That conflated this table with SendGrid's suppression
-- list. **The unsubscribe guarantee lives in SendGrid**, permanently and keyed
-- on the address - which is the whole reason specs/completed/email.md put it
-- there instead of in a column here. This table only stops a live user being
-- sent the same email twice.
CREATE TABLE `email_send` (
  `user_id` varchar(255) NOT NULL COMMENT 'auth0 id; intentionally not a FK, see above',
  `kind` varchar(64) NOT NULL COMMENT 'welcome | tips | recipes | feedback',
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `kind`)
);

-- When the email programme went live. Exactly one row, forever.
--
-- The onboarding sequence fires only for Users created after this moment.
-- specs/completed/email.md argues the case at length under "New signups only": a "Welcome
-- to Big Shop!" landing on somebody who joined eight months ago reads as broken,
-- and long-dormant addresses are the likeliest to mark a first send as spam -
-- which poisons the suppression list permanently, on a brand-new sending domain,
-- before it has any reputation to spend.
--
-- **A row stamped when this migration runs, rather than a date constant in Go.**
-- The spec called for a "launch cutoff constant" but never named a date, and a
-- hand-picked one is wrong in both directions: set in the past it mails the back
-- catalogue, set in the future it silently sends nothing until someone notices.
-- Deriving it from when the schema arrived needs no decision, cannot drift from
-- the deploy, and is the same value on every environment including a fresh e2e
-- database.
--
-- **The rejected alternative was backfilling `email_send` rows for every
-- existing user**, which would suppress them through the mechanism that already
-- exists and need no table at all. It was rejected because a row in that table
-- means "handed to SendGrid", and writing four for every existing user records
-- sends that never happened - the log would begin its life lying, and every
-- future question asked of it ("did we email this person?") would get a wrong
-- answer.
--
-- The CHECK constraint pins it to a single row. MySQL 8.0.16+ enforces these
-- rather than parsing and ignoring them, so a second INSERT fails loudly instead
-- of quietly giving the due-query two cutoffs to choose between.
CREATE TABLE `email_launch` (
  `id` tinyint NOT NULL DEFAULT 1,
  `launched_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_email_launch_single_row` CHECK (`id` = 1)
);

INSERT INTO `email_launch` (`id`) VALUES (1);
