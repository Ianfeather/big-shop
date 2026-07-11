-- Units are now upserted on recipe save (mirroring how ingredients already work) so a
-- previously-unseen unit (e.g. "bunch") gets added instead of failing the save with a
-- NOT NULL constraint violation on part.unit_id. That upsert relies on this uniqueness.
--
-- Before running against a database with existing data, check for pre-existing
-- case-insensitive duplicates first, since this will fail otherwise:
--   SELECT LOWER(name), COUNT(*) FROM unit GROUP BY LOWER(name) HAVING COUNT(*) > 1;
ALTER TABLE unit ADD UNIQUE (name);
