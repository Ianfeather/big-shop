-- One charset for the whole database: utf8mb4 / utf8mb4_bin.
--
-- Production TiDB had no single charset. Each table took whatever the server
-- default was on the day it was hand-applied, leaving three tiers (measured
-- 2026-08-20 via scripts/check-charsets.sh, server 8.0.11-TiDB-v8.5.3):
--
--   latin1_bin   ingredient, list, part, unit
--   utf8_bin     account, account_user, department, ingredient_department,
--                invite, recipe, user          (utf8mb3 - deprecated)
--   utf8mb4_bin  consent_event, email_launch, email_send, ga_account_uuid,
--                ingredient_unit_size, recipe_tag, shopping_list_event, tag
--
-- Two consequences have already been paid for: docker/README.md records an
-- incompatible-FK error between recipe_tag.tag_name and tag.name when
-- importing production's DDL, which is why sync-from-prod.sh dumps data only;
-- and migration 034 could not be applied until user.id was normalised.
--
-- WHY latin1 IS THE SHARP EDGE. latin1 cannot represent anything outside its
-- 256 characters, so an ingredient called "gochujang 고추장" cannot round-trip.
-- ingredient.name already holds 2 non-ASCII rows of 439. Nothing is damaged
-- today - the scan found zero mojibake anywhere in the database - so this is
-- latent, and the point of doing it now is that it stays that way.
--
-- WHY THE utf8mb3 TABLES TOO. utf8mb3 holds the Basic Multilingual Plane but
-- not the astral planes, so it rejects emoji and much CJK extension. recipe
-- .method alone has 41 non-ASCII rows and is free text pasted from the web.
--
-- WHY THE utf8mb4_bin TABLES TOO, which are already correct in production.
-- There the eight ALTERs are no-ops. They are here for the *local* database,
-- which migrations/*.sql builds as uniformly utf8mb4_0900_ai_ci - case- and
-- accent-INSENSITIVE, where production has always been _bin and therefore
-- SENSITIVE. That divergence is invisible until a query that dedupes on a name
-- behaves one way on a laptop and another in production. Converting everything
-- makes the two match for the first time.
--
-- WHY utf8mb4_bin AND NOT utf8mb4_0900_ai_ci. TiDB v8.5.3 does support
-- 0900_ai_ci (the "unavailable before 7.4" caveat no longer applies), but it
-- would change comparison semantics on every string in production, silently
-- merging rows that differ only by case or accent. utf8mb4_bin is what
-- production already uses and what the user.id key family was normalised to.
--
-- FOREIGN_KEY_CHECKS. Two text columns in the schema are FK'd -
-- account_user.user_id -> user.id and recipe_tag.tag_name -> tag.name. A
-- foreign key requires both sides to share a collation, so converting either
-- side on its own fails with ERROR 3780 "Referencing column and referenced
-- column are incompatible". Disabling the check spans the pair; both sides are
-- converted below, so the constraint is satisfied again by the end.

SET FOREIGN_KEY_CHECKS = 0;

-- The database default, so anything created later inherits it rather than
-- restarting the patchwork. Already utf8mb4_bin in production; this is what
-- moves the local database off utf8mb4_0900_ai_ci.
ALTER DATABASE `bigshop` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- latin1_bin -> utf8mb4_bin. ingredient.name and unit.name each carry a UNIQUE
-- index (migrations 002 and 016) and unit.kind is an enum whose value strings
-- carry the charset; scripts/probe-charset-conversion.sh exercises both shapes.
ALTER TABLE `ingredient` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `list`       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `part`       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `unit`       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- utf8mb3 -> utf8mb4.
ALTER TABLE `account`               CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `account_user`          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `department`            CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `ingredient_department` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `invite`                CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `recipe`                CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `user`                  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- Already utf8mb4_bin in production, so no-ops there. Locally these are what
-- move the remaining tables off utf8mb4_0900_ai_ci.
ALTER TABLE `consent_event`        CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `email_launch`         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `email_send`           CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `ga_account_uuid`      CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `ingredient_unit_size` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `recipe_tag`           CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `shopping_list_event`  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `tag`                  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

SET FOREIGN_KEY_CHECKS = 1;
