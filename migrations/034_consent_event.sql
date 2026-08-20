-- An append-only record of every analytics-consent decision a signed-in User
-- has made.
--
-- **Append-only is the whole point, and the thing most likely to be "fixed"
-- later.** A table whose current state is UPDATEd answers "what do they think
-- now", which the browser's own localStorage already answers, and which nothing
-- needs a database for. The question this exists for is "what did they consent
-- to, and when" - including consents that have since been withdrawn, which are
-- exactly the rows an UPDATE would destroy. Under UK GDPR the burden is on us
-- to demonstrate that consent was given; a row that has been overwritten
-- demonstrates nothing.
--
-- So: INSERT only, and never UPDATE. A withdrawal is a new row saying
-- `analytics = FALSE`, not an edit to the row that said TRUE.
--
-- **The append-only rule is about never rewriting a decision that was made. It
-- is not a promise that a row lives forever**, and the two were run together in
-- the first draft of this comment, which said "never DELETE" as well. Erasing a
-- person entirely is a different act from revising their history, and it is
-- ruled in rather than out - see the erasure note below.
--
-- **No IP address and no user agent**, and this is deliberate rather than an
-- oversight. It is the obvious column to add - proof of consent feels like it
-- wants proof of who - but it would put fresh personal data into the one table
-- that exists for privacy compliance, and it is not what is being asked for:
-- the ICO's expectation is a record of *how* and *when* consent was given,
-- which `source` and `created_at` already carry. Adding it would also make this
-- table itself a thing that needs a lawful basis and a retention policy.
--
-- **Signed-in Users only.** The decision is taken on the marketing page by
-- someone who usually has no account, and their choice is honoured entirely
-- from localStorage; it reaches here when (and only when) they log in. The
-- alternative - a public write endpoint keyed by a random client-minted id -
-- was rejected in specs/completed/analytics-and-consent.md: it would mean minting a
-- tracking identifier for someone who may have just declined, which is a
-- strange way to document lawful processing. The accepted gap is that a visitor
-- who accepts and never signs up has no row here.
--
-- **Account deletion deletes these rows** (board item #59, resolved
-- 2026-08-18). This is the answer to the question the earlier version of this
-- note left open, recorded here because here is where it told you to look.
--
-- The question was genuinely awkward, and two decisions on #59 could not both
-- hold. These rows exist to prove the processing was lawful, so erasing them
-- destroys that evidence; but `user_id` carries a foreign key to `user.id`, so
-- deleting the person with their consent rows still present fails outright.
-- The obvious compromise - keep the row, sever the link, by nulling `user_id`
-- or replacing it with a digest or a mapping-table id - was considered and
-- rejected, because **severing the link destroys the very thing the retention
-- was for.** These rows were kept to prove that *a specific person* consented.
-- Break that link by any mechanism and what survives says "somebody consented
-- on this date, under this policy version, via the banner" - which rebuts
-- nothing if an ex-user later claims they were tracked without consent. So
-- delinking does not serve the principle that motivated keeping the row; it
-- only pays schema complexity to retain something inert.
--
-- The legal shape agrees. The UK GDPR Article 7(1) duty to demonstrate consent
-- runs for data subjects whose data you process, and after erasure you process
-- none of theirs.
--
-- A tombstone `user` row was rejected for a plainer reason: it satisfies the
-- foreign key by keeping an Auth0 subject in plaintext for somebody we have
-- just told we erased.
--
-- So: `DELETE FROM consent_event WHERE user_id = ?`, inside the deletion
-- transaction, ordered before the `user` row. **This needs no schema change at
-- all** - no dropped foreign key, no new column. Deleting children before the
-- parent is what the constraint is for. See service.deleteAccountTx and
-- specs/completed/account-deletion.md.
--
-- ## Why this file starts by rewriting three columns it did not create
--
-- `user.id` does not have the same collation in the two databases this file
-- has to run against, and the foreign key at the bottom cannot be created
-- until it does. Production TiDB holds it as `utf8` / `utf8_bin` (utf8mb3 -
-- the server default on the day `008_user.sql` was applied by hand); a local
-- MySQL 8 built from `migrations/*.sql` holds it as `utf8mb4` /
-- `utf8mb4_0900_ai_ci`. InnoDB requires an *exact* charset-and-collation match
-- on both sides of a string foreign key, so a `consent_event.user_id` that
-- satisfies one database is rejected by the other with
--
--   ERROR 3780: Referencing column 'user_id' and referenced column 'id' in
--   foreign key constraint 'fk_consent_event_user_id' are incompatible.
--
-- Both directions of that were tried before this. Declaring no charset (so the
-- column inherits whatever the database default is) fails in production;
-- pinning `utf8_bin` to match production fails locally. **There is no literal
-- that works in both, because the parent column genuinely is two different
-- things** - so the parent gets fixed rather than the child humoured.
--
-- `utf8mb4_bin` is the target because it is the only choice that is available
-- on both engines *and* preserves the comparison semantics of the column being
-- changed. `utf8_bin` is utf8mb3, which MySQL has deprecated. MySQL 8's own
-- default, `utf8mb4_0900_ai_ci`, does not exist in TiDB before 7.4 and is
-- accent- and case-insensitive - a bad property to introduce on the primary
-- key of a table of Auth0 subject identifiers, where two ids differing only by
-- case would newly collide. `utf8mb4_bin` keeps the byte-exact comparison
-- `utf8_bin` already gave production.
--
-- **This is deliberately not the whole clean-up.** Production's charsets are a
-- patchwork accreted over years - `list` and `part` are `latin1_bin`, `tag` is
-- `utf8mb4_bin`, `recipe` and `account` are `utf8_bin` - and normalising all
-- of it is its own piece of work, not something to smuggle into the consent
-- migration. What is here is the `user.id` key family and nothing else:
-- the column, the one column that carries a foreign key to it, and
-- `invite.admin_id`, which holds the same Auth0 id under a different name.
--
-- The `DROP FOREIGN KEY` below is the one statement that behaves differently
-- on the two engines, and it is expected to fail in production. MySQL will not
-- alter a column while a constraint points at it, so locally the constraint
-- must come off and go back on around the change. Production never created it:
-- TiDB declares only a fraction of the foreign keys `migrations/*.sql` does
-- (see docker/README.md and scripts/check-orphans.sh, which counts both for a
-- given database rather than quoting a number), and `account_user` there has
-- a plain `KEY` where this repo declares a constraint. Dropping a constraint
-- that does not exist is an error, not a no-op, so a production run skips this
-- statement - the local seeding script passes `mysql --force` and skips it for
-- the same reason on a database that has somehow already lost it.
ALTER TABLE `account_user` DROP FOREIGN KEY `fk_account_user_user_id`;

ALTER TABLE `user`
  MODIFY `id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'auth0 id';

ALTER TABLE `account_user`
  MODIFY `user_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'auth0 id';

ALTER TABLE `invite`
  MODIFY `admin_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'the user who invited them';

-- Recreating the constraint is a local-only restoration of what the DROP above
-- removed. In production it *adds* a foreign key that has never been there,
-- which TiDB 6.6+ will genuinely enforce - so run scripts/check-orphans.sh
-- first: it fails against existing orphan rows rather than skipping them.
ALTER TABLE `account_user`
  ADD CONSTRAINT `fk_account_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`);

CREATE TABLE `consent_event` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `user_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'auth0 id; FK to user.id, the same key account_user.user_id uses',
  `analytics` boolean NOT NULL COMMENT 'TRUE = granted, FALSE = declined or withdrawn',
  -- The version of the privacy policy the decision was made against, as a date
  -- string (lib/consent.ts's POLICY_VERSION). This is what lets a future
  -- material change to the policy re-prompt only the people whose consent
  -- predates it, rather than re-prompting everybody or nobody.
  `policy_version` varchar(32) NOT NULL COMMENT 'POLICY_VERSION the decision was made against',
  -- How the decision was given, which is the "how" half of what a consent
  -- record is required to carry. `banner` and `settings` name the control the
  -- person actually used, and stay true even when the row is written later -
  -- a choice made on the banner while logged out is still a banner choice when
  -- it is carried in at login, and created_at already records that we only
  -- learned it then. `login-sync` is for a row no control can be attributed
  -- to: a back-fill, or a test harness seeding a starting state.
  `source` ENUM('banner', 'settings', 'login-sync') NOT NULL COMMENT 'which control produced this decision',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Every read is "the latest decision for this user", so the index is on the
  -- pair rather than on user_id alone.
  KEY `idx_consent_event_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_consent_event_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`)
);
