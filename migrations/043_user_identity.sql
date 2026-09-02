-- One person, many ways of signing in.
--
-- **Why this table exists.** `user.id` has always held the raw Auth0 subject,
-- with no foreign key to Auth0 and nothing anywhere detecting a mismatch. A
-- subject nobody has seen before is therefore indistinguishable from a new
-- person: the API creates a User row and hands them a brand-new, empty Account.
-- That is correct for a new person and catastrophic for an existing one, and
-- the two are the same request. Add Microsoft or Apple alongside Google and an
-- existing customer signing in the "wrong" way loses every recipe they own,
-- with no error raised at any layer.
--
-- This table is the indirection that makes them distinguishable: a subject
-- resolves to a `user_id`, and two subjects belonging to the same human resolve
-- to the same one.
--
-- **Why here and not in `account_user`.** The obvious alternative - give the new
-- subject its own `user` row and a second `account_user` row pointing at the
-- same Account - breaks three things, because a great deal of shipped code
-- assumes one human is one `user.id`:
--
--   * `otherMembersQuery` counts `account_user WHERE user_id != ?`, so the
--     person's *other* identity reads as another member. Deletion takes the
--     shared branch, and the Account, its Recipes, its list and its
--     `ga_account_uuid` all survive a request to erase them. Meanwhile
--     `DeleteAuth0User` removes only the subject they happened to log in with.
--     They ask to delete their account via one provider and can still sign in
--     with the other and find everything there.
--   * `GetAccount` returns a row per membership, so the account page reports the
--     Account as shared and the deletion confirmation promises to keep their
--     Recipes for the other members - wrong copy at the moment it matters most.
--   * Anything matching a person by identity gets two answers.
--
-- Aliasing *above* `user` instead of *beside* it means none of that changes.
-- Every downstream table, query and cascade keeps seeing exactly one user,
-- because there is exactly one. This migration adds a table and changes no
-- other; that is the point of it.
--
-- **The primary key is the subject**, not a surrogate: a subject belongs to
-- exactly one person, and making that a key rather than a convention is what
-- stops one being linked to two users. There is deliberately no unique
-- constraint on `user_id` - holding several subjects is the entire feature.
--
-- `ON DELETE CASCADE` because these rows are meaningless without the user they
-- point at, and the erasure path deletes users. Without it the cascade in
-- service/erasure.go would fail on the foreign key rather than complete, which
-- is a worse failure than it sounds: erasure is a legal obligation and its
-- steps are ordered so that a failure leaves a gated, retryable Account. A
-- constraint violation there would be a permanently un-deletable account.
CREATE TABLE `user_identity` (
  `subject` varchar(255) NOT NULL COMMENT 'auth0 sub, as it arrives in the JWT',
  `user_id` varchar(255) NOT NULL COMMENT 'the person this subject signs in as',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`subject`),
  KEY `idx_user_identity_user_id` (`user_id`),
  CONSTRAINT `fk_user_identity_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
);

-- Every existing user signs in as themselves. Their `user.id` *is* their only
-- subject today, so the backfill is the identity mapping and the table starts
-- consistent with every row that already references `user.id`.
--
-- This is what lets the lookup be unconditional rather than "check the table,
-- and fall back to treating the subject as a user id if it is missing". A
-- fallback would be indistinguishable from the bug this exists to prevent: an
-- unmapped subject would quietly resolve to itself and mint a fresh Account.
INSERT INTO `user_identity` (`subject`, `user_id`)
  SELECT `id`, `id` FROM `user`;
