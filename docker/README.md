# Local dev data: synthetic seed vs. your real production recipes

`npm run dev:full` (see `../scripts/dev-full.sh`) brings up a local MySQL
container. By default, the *first* time its data volume is created, MySQL
runs everything in `mysql-init/` automatically, which applies
`../migrations/*.sql` and then `mysql-seed/dev-seed.sql` - two small
synthetic recipes, just enough to exercise every page. That happens once per
volume - it doesn't re-run on every `docker compose up` (see `CLAUDE.md`).

This doc covers the alternative: pulling in your own real recipes from
production instead of the two made-up ones.

## What `scripts/sync-from-prod.sh` does

One command, no arguments or env vars:

```bash
scripts/sync-from-prod.sh
```

It prompts for TiDB host, port (defaults to `4000`), username, password, and
account id (defaults to `1`), then:
1. Exports full copies of the shared reference tables - `ingredient`,
   `unit`, `tag`, `department`, `ingredient_department`. These aren't
   scoped to any account, so they're pulled in whole.
2. Exports **only** `recipe`/`part`/`recipe_tag` rows belonging to the
   account id you enter - never other accounts' data, not even transiently
   in the dump file.
3. Saves all of that to `docker/prod-dumps/prod-sync-<id>-<timestamp>.sql`
   (gitignored - these contain real recipe data and must never be
   committed).
4. Imports it into the local `db` container, then remaps the imported
   recipes to local account `1`.

`local-dev-user` (the fixed identity `DISABLE_AUTH` mode uses) is already
linked to local account `1` by the synthetic seed, so after this runs it
just sees your real recipes instead of the two synthetic ones - no other
setup needed. `user`/`account`/`account_user` are never touched by this
script, only the recipe-related tables.

**Heads up**: importing replaces the local `recipe`, `part`, `recipe_tag`,
`ingredient`, `unit`, `tag`, and `department` tables entirely. Any test
recipes you'd added locally through the app are gone after this runs.

## Before running it: find your account id

`migrations/012_user_account.sql`'s comment ("Swapping buzzfeed and personal
account") means whichever account id is *yours* may not be `1` in
production anymore. Confirm it first by running this in the TiDB Console
SQL editor (link in `CLAUDE.md`):

```sql
SELECT * FROM account_user;
```

Your row's `account_id` is the value to enter when the script prompts for it.

## Connection details

- Host / username - from your TiDB Cloud cluster (same values used in the
  production `DSN`, just the individual pieces rather than one connection
  string).
- Port - defaults to `4000`, TiDB Cloud's protocol port (not MySQL's usual
  `3306`). Only enter a different one if yours differs.
- Password - never passed as an argument or stored anywhere. The script
  prompts for it once (silently) and holds it only in memory for the
  `mysqldump` calls that need it.

## Why mysqldump runs inside Docker

`mysqldump` doesn't run against a host install - each export call runs
inside a throwaway `mysql:8.0` container instead
(`docker run --rm mysql:8.0 mysqldump ...`). Two reasons:
- Nothing needs installing locally at all, consistent with the rest of this
  setup (no Go or MySQL toolchain required on your machine either).
- Newer client libraries (MySQL 9+, e.g. Homebrew's current `mysql` package)
  have dropped the `mysql_native_password` authentication plugin entirely,
  which many TiDB user accounts still use - connecting fails with an
  `Authentication plugin 'mysql_native_password' cannot be loaded` error.
  MySQL 8.0's client (what the container runs) still bundles that plugin, so
  this sidesteps the issue without touching anything on the TiDB side.

## Why no `--single-transaction`

`mysqldump --single-transaction` wraps every table it dumps - even just one
- in a `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` pair, and TiDB's `SAVEPOINT`
support doesn't fully match MySQL's here: it fails with `Couldn't execute
'ROLLBACK TO SAVEPOINT sp': SAVEPOINT sp does not exist`. The script uses
`--skip-lock-tables` instead - TiDB is MVCC-based like InnoDB, so an
unlocked read is no less consistent than what `--single-transaction` would
have given for this use case, and it also avoids needing `LOCK
TABLES`/`FLUSH TABLES WITH READ LOCK` privileges a TiDB Cloud user may not
have anyway.

## Why not TiDB's own export feature, or the web SQL editor?

TiDB Cloud's bulk "Export to storage" feature is typically a Dedicated-tier
capability - a small/free-tier cluster (this app's likely tier) probably
only exposes the web SQL Editor (fine for ad hoc queries, but row-limited
and can't cascade across joined tables) or plain MySQL wire-protocol access.
`mysqldump`/`mysql` CLI work over that same protocol regardless of tier -
the same access the app's own `DSN` already relies on - so that's what this
script uses. Auth0 never comes into it either way: it gates the
*application's* API, not direct database access.

This has been run against a real TiDB Cloud cluster; two issues surfaced so
far, both fixed above - a MySQL 9 client's `mysql_native_password`
incompatibility (running `mysqldump` inside Docker instead), and
`--single-transaction`'s `SAVEPOINT` handling not matching TiDB's (using
`--skip-lock-tables` instead). If another `mysqldump` flag needs adjusting
for TiDB's exact feature set, let me know what error you see and we'll fix
it.

## Reverting to the synthetic seed

```bash
docker compose down -v
npm run dev:full
```

`down -v` deletes the data volume entirely, so the next start is a genuinely
empty database again, and the synthetic migrate-and-seed step in
`mysql-init/` runs fresh.
