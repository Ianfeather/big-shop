-- A random UUID per Account, sent to Google Analytics in place of `account.id`.
--
-- **What this buys is unlinkability, not deletion**, and the distinction is the
-- whole point of the table. Deleting a row here deletes nothing inside Google.
-- Google keeps whatever it has already collected, plus its own `_ga` client id
-- and IP-derived geography, regardless of anything we do.
--
-- So why build it. Google's Data Deletion API (`submitUserDeletion`) accepts
-- only `userId`, `clientId`, `appInstanceId` and `userProvidedData` — a custom
-- user property is not among them, and `lib/analytics/ga.ts` deliberately sends
-- the Account as a *user property* and never as `user_id` (ADR-0008 §1: the
-- Auth0 subject never reaches Google, and a `user_id` would assert a
-- cross-device person identity we do not want to assert). That combination
-- makes the deletion API unusable for us, so the only lever available is to
-- stop the identifier being meaningful in the first place.
--
-- Sending a random UUID means `account.id` stops being the same join key across
-- Google, Grafana and our own database. This table becomes the only place that
-- link exists — backups and logs included — and deleting the row severs it.
-- What is left in Google is a UUID nobody can tie back to an Account.
--
-- **`account_id` is not a foreign key**, deliberately. The row is deleted by
-- account deletion before the `account` row itself, and a constraint would add
-- nothing: an orphan here is harmless (a UUID for an Account that no longer
-- exists is exactly as unlinkable as no row at all), while the constraint would
-- be one more ordering rule for the cascade to get right.
--
-- The UUID is minted lazily on first read rather than backfilled here, so
-- existing Accounts pick one up the next time anybody loads a page. A backfill
-- would need a UUID generator in SQL and would mint identifiers for Accounts
-- that may never be visited again.
--
-- Board item #59; see specs/completed/account-deletion.md, "GA4 — a UUID mapping table".

CREATE TABLE `ga_account_uuid` (
  `account_id` int NOT NULL COMMENT 'the Account this identifier stands for; not an FK, see the header',
  `uuid` char(36) NOT NULL COMMENT 'random v4 UUID, the only thing Google is ever told',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`account_id`),
  -- Nothing looks a row up by UUID today. The index is here because the one
  -- question anybody will ever ask of this table from the outside is "which
  -- Account is this identifier in a Google report", and that is a lookup by
  -- UUID.
  UNIQUE KEY `idx_ga_account_uuid_uuid` (`uuid`)
);
