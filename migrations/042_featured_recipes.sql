-- Featured Recipes: Big Shop's own content, published from an admin's Account.
--
-- See docs/adr/0011-featured-recipes-are-our-own-content.md and
-- specs/featured-recipes.md. A Featured Recipe is an ordinary Recipe, in an
-- Account whose owner is an admin, that an admin has marked as eligible for any
-- other Account to take a copy of. Nothing here makes a Recipe readable outside
-- its Account by any other route.

-- Who may set `recipe.featured`.
--
-- A column on `user` rather than an `admin_user` table (one row, and
-- service.deleteAccountTx would then have to clean it up on erasure - a column
-- dies with the user for free) and rather than an environment variable of Auth0
-- subject ids (invisible in the data, changed only by redeploy). Granted by
-- hand; there is no code path that sets it and no UI that offers it.
ALTER TABLE `user`
  ADD COLUMN `is_admin` tinyint(1) NOT NULL DEFAULT 0
  COMMENT 'may publish a Recipe as Featured; granted by hand, see ADR-0011';

-- Eligible to be copied by any Account - and nothing else.
--
-- In particular this does NOT mean "appears in the Day 8 onboarding email".
-- Which Featured Recipes that email links to is an editorial choice made in
-- templates/recipes.html, which is why this is a boolean and not a position.
ALTER TABLE `recipe`
  ADD COLUMN `featured` tinyint(1) NOT NULL DEFAULT 0
  COMMENT 'eligible for any Account to copy; set only by an admin';

-- Which Featured Recipe a copy came from.
--
-- Load-bearing rather than bookkeeping: it is how a second click on the same
-- email link finds the copy the first one made, instead of silently adding a
-- duplicate. It is also the only record of whether those links are ever used,
-- which is why the question needs nothing sent to Google (ADR-0008 §1).
ALTER TABLE `recipe`
  ADD COLUMN `featured_from` int NULL
  COMMENT 'the Featured Recipe this row was copied from, if it was';

-- ON DELETE SET NULL, deliberately unlike the plain RESTRICT of
-- 041_account_id_foreign_keys.sql, and the difference matters in both
-- directions.
--
-- RESTRICT here would mean a Featured Recipe could never be deleted once
-- anybody had taken a copy - the curator's own Account would accumulate rows it
-- was not allowed to remove. Worse, service.deleteAccountTx deletes an
-- Account's recipes on erasure, so an Account holding a Featured Recipe that
-- had been copied could not be erased at all: a right-of-erasure request
-- failing on a foreign key.
--
-- CASCADE would be wrong in the other direction, and much worse - deleting a
-- Featured Recipe would delete every copy of it out of strangers' Accounts.
-- A copy is an independent Recipe from the moment it is made; the source going
-- away means only that its provenance is no longer knowable.
ALTER TABLE `recipe`
  ADD CONSTRAINT `fk_recipe_featured_from`
  FOREIGN KEY (`featured_from`) REFERENCES `recipe` (`id`)
  ON DELETE SET NULL;

-- The lookup POST /recipe/featured/{slug} performs, in column order:
-- `WHERE slug = ? AND featured = 1`. Composite rather than an index on
-- `featured` alone, which is two-valued and overwhelmingly one of them.
ALTER TABLE `recipe`
  ADD KEY `idx_recipe_featured_slug` (`featured`, `slug`);

-- One copy of a given Featured Recipe per Account, enforced rather than
-- checked.
--
-- CopyFeaturedRecipe looks for an existing copy before inserting, and that
-- check is not atomic: two requests arriving together both find nothing and
-- both insert. That is not a hypothetical - it showed up in the e2e suite as a
-- second Recipe appearing from one visit, which is precisely the duplicate
-- `featured_from` exists to prevent. A link in an email is exactly the thing
-- that gets opened twice at once, on a phone and a laptop.
--
-- NULLs do not collide in a MySQL unique index, so every ordinary Recipe -
-- which has no provenance - is unaffected, however many an Account holds.
ALTER TABLE `recipe`
  ADD UNIQUE KEY `uniq_recipe_account_featured_from` (`account_id`, `featured_from`);
