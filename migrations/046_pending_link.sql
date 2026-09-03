-- A link attempt in flight: someone has said "I have another account" and has
-- gone off to prove it by signing into that account.
--
-- **Why a row rather than a signed stateless token.** Both would carry the
-- binding to a subject and an expiry perfectly well, and a signed value needs
-- no table. The property that decides it is *single use*: a stateless token is
-- replayable for as long as it is valid, and this one authorises permanently
-- bonding a login to an account. Deleting the row at completion is what makes
-- a second use impossible rather than merely unlikely, and there is nowhere to
-- delete from without a table. `purgeExpiredInvites` is the established
-- pattern for cleaning one up lazily, and this table borrows it exactly.
--
-- **`granted_subject`, not `subject`.** The column holds the identity that will
-- be *given* access, which is the reverse of what a bare `subject` reads as on a
-- table about linking, and getting it backwards is the one misreading that would
-- produce a working-looking implementation with the grant pointing the wrong
-- way. The row is written by the person sitting in the empty account, naming
-- *their own* new login, and is redeemed by that same person once they have
-- re-authenticated as the established account they want that login to reach.
--
-- Nothing here names a target, deliberately: who does the granting is not known
-- until completion, and a token that named the account it would reach would be
-- worth stealing.
--
-- **The nonce is stored as a digest, and the token is not.** They are not the
-- same kind of secret. The token is handed to the caller in a response body and
-- is useless without the nonce, so hashing it would buy nothing that the
-- expiry and the single use do not already buy. The nonce never leaves the
-- browser's own origin until it is redeemed, and it is the thing that makes the
-- grant non-transferable - so the one place it must not be readable is a
-- database dump, which is exactly what storing the digest achieves.
--
-- A plain SHA-256 rather than the peppered HMAC `invite.email` uses, and the
-- difference is the input rather than the storage. An email address comes from
-- an enumerable space, so an unpeppered digest lets anyone holding a dump
-- confirm a guess; a 32-byte random nonce cannot be guessed, so a pepper would
-- defend against nothing and would add a deployment secret this table would
-- silently stop working without.
CREATE TABLE `pending_link` (
  `token` varchar(128) NOT NULL COMMENT 'handed to the caller by POST /link/start',
  `granted_subject` varchar(255) NOT NULL COMMENT 'the auth0 sub that will gain access',
  `nonce_hash` varchar(64) NOT NULL COMMENT 'sha-256 of the browser-held nonce',
  `expires` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  -- Not unique: a person who abandons an attempt and starts another would
  -- otherwise collide with their own dead row. StartLink clears a subject's
  -- previous rows itself, so at most one is live at a time by construction
  -- rather than by constraint - which is the right way round, because a
  -- constraint here would turn a retry into a 500.
  KEY `idx_pending_link_granted_subject` (`granted_subject`)
);
