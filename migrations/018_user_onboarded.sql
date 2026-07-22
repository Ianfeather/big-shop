-- Tracks whether a user has completed the one-time onboarding screen shown
-- at "/". Defaults false so existing rows (and newly-inserted ones) see it
-- once; the app flips it to true after their first authenticated visit.
ALTER TABLE `user` ADD COLUMN `onboarded` BOOLEAN NOT NULL DEFAULT FALSE;
