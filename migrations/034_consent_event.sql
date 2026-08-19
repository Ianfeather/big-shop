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
-- specs/account-deletion.md.
CREATE TABLE `consent_event` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `user_id` varchar(255) NOT NULL COMMENT 'auth0 id; FK to user.id, the same key account_user.user_id uses',
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
