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
4. Truncates those same 8 tables locally, imports the dump's data into
   them, then remaps the imported recipes to local account `1`.

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

- Host / username / password - all three can be read straight out of the
  production `DSN` connection string, which lives in Netlify's environment
  variables UI (see the Netlify Dashboard link in `CLAUDE.md`) rather than
  anywhere in this repo. The `DSN` format is
  `user:password@tcp(host:port)/bigshop?...` (see `main.go`'s
  `sql.Open("mysql", os.Getenv("DSN"))`). The query parameters after the `?`
  are load-bearing rather than incidental - see
  [technical-architecture.md](../technical-architecture.md#the-dsns-query-parameters)
  before rewriting one.
- Port - defaults to `4000`, TiDB Cloud's protocol port (not MySQL's usual
  `3306`). Only enter a different one if yours differs.
- Password - never passed as an argument or stored anywhere by the script.
  It prompts for it once (silently) and holds it only in memory for the
  `mysqldump` calls that need it. Credential-injection tooling (1Password
  CLI, macOS Keychain) was considered and deliberately skipped for now -
  1Password's seamless biometric-unlock flow is inherently host-bound and
  can't run purely in Docker, and the fully-containerized alternative
  (service account tokens) needs a compatible plan tier and a separate
  shared vault, which wasn't judged worth it yet.

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

## Why data only, no schema

The dump is `--no-create-info` - data only, no `DROP`/`CREATE TABLE`. The
local `bigshop` database already has a correct, internally-consistent
schema from `migrations/*.sql`; we only want prod's *data*. Importing
TiDB's dumped `CREATE TABLE` statements hit an `Incompatible` foreign key
error between `recipe_tag.tag_name` and `tag.name` - each table's dump is a
separate `mysqldump` invocation, and TiDB's per-table charset/collation
metadata wasn't identical between them, which MySQL 8 rejects at
`CREATE TABLE` time even though the underlying data types match. Skipping
schema entirely and truncating the already-correct local tables before
importing data sidesteps that whole class of DDL-compatibility problem.

## Why not TiDB's own export feature, or the web SQL editor?

TiDB Cloud's bulk "Export to storage" feature is typically a Dedicated-tier
capability - a small/free-tier cluster (this app's likely tier) probably
only exposes the web SQL Editor (fine for ad hoc queries, but row-limited
and can't cascade across joined tables) or plain MySQL wire-protocol access.
`mysqldump`/`mysql` CLI work over that same protocol regardless of tier -
the same access the app's own `DSN` already relies on - so that's what this
script uses. Auth0 never comes into it either way: it gates the
*application's* API, not direct database access.

This has been run against a real TiDB Cloud cluster; three issues surfaced
so far, all fixed above - a MySQL 9 client's `mysql_native_password`
incompatibility (running `mysqldump` inside Docker instead),
`--single-transaction`'s `SAVEPOINT` handling not matching TiDB's (using
`--skip-lock-tables` instead), and a cross-table charset/collation FK
mismatch when importing TiDB's schema (switched to data-only dumps against
the local, already-migrated schema). If another issue turns up, let me know
what error you see and we'll fix it.

## Reverting to the synthetic seed

```bash
docker compose down -v
npm run dev:full
```

`down -v` deletes the data volume entirely, so the next start is a genuinely
empty database again, and the synthetic migrate-and-seed step in
`mysql-init/` runs fresh.

## Checking for orphaned rows: `scripts/check-orphans.sh`

```bash
scripts/check-orphans.sh
```

Read-only, so it is safe against production at any time. It reports rows whose
foreign key points at a parent row that no longer exists. Run it before a data
migration for a baseline, and after to prove nothing was stranded.

**Production does not have the constraints local MySQL has**, and that
difference is the whole reason this exists. Every constraint in
`migrations/*.sql` is `NO ACTION`, so deleting a row that still has children
errors out against a database built from those migrations. TiDB declares **7
foreign keys where local MySQL declares 15**, so the same statement can succeed
against production and leave the children dangling with no error at all.
Migration `029` did this: it deleted `thyme sprig` while an Ingredient Line
still referenced it, and Potato & Leek Soup silently lost its thyme. Nothing in
the test suite could catch it, because the tests run against MySQL.

That gap is also why the check does not trust declared constraints alone -
doing so would cover fewer than half the schema and still report clean.
`scripts/check-orphans.sql` unions the declared foreign keys with every column
named `<table>_id` whose table exists, giving 21 relationships against the 15
declared locally. Expect "Relationships checked" to exceed `declared_fks`.

It runs in two steps - introspect, then build and execute - rather than
generating the checks in SQL, because **TiDB rejects `SELECT ... INTO @var`**
outright and the dynamic-SQL version failed there while passing on MySQL. To
read the generated SQL without running it:

```bash
docker compose exec -T db mysql -uroot -proot -N bigshop \
  < scripts/check-orphans.sql | scripts/build-orphan-checks.py
```

The stronger habit for anything that deletes rows is to **rehearse the migration
against a scratch copy of a backup first**, since that reproduces production's
actual constraint behaviour rather than local MySQL's:

```bash
gzip -dc ~/big-shop-backups/<dump>/*-schema.sql.gz ~/big-shop-backups/<dump>/*.0000*.sql.gz \
  | docker compose exec -T db mysql -uroot -proot   # into a scratch database
```

Then apply the migrations in order and compare row counts before and after. The
count that matters is `part`: Ingredient Lines in should equal Ingredient Lines
out unless the migration is explicitly meant to remove some.

## Backfilling missing Methods: `scripts/backfill-recipe-method.mjs`

Most of the catalog arrived with ingredients but no method (`follow-ups.md`
#41). For a Recipe that carries a `remote_url`, the method is still sitting on
the page it was imported from, so it can be read back:

```bash
npm run dev:full                                  # in another terminal
scripts/backfill-recipe-method.mjs --limit 3      # try a few first
scripts/backfill-recipe-method.mjs                # the full run
```

**Run it against a freshly synced copy of production** (`sync-from-prod.sh`
above). It writes SQL targeting rows by the id it read locally, which is only
production's id because the sync carries ids verbatim.

It writes a numbered file into `migrations/` and touches no database itself, so
the SQL can be read before anything is applied. Apply it the way you would any
other data migration.

**It drives the running app's `/api/parse-recipe-url` rather than importing the
extractor directly.** That is the point: the backfill reads pages through
exactly the code path the app uses - the JSON-LD preference, the visible-text
fallback, and the "no ingredients means the page was not read" guard - rather
than a second extraction that could drift from it. It also means the script
needs no OpenAI key of its own.

**Only the method is kept.** Everything else the extraction returns is discarded
unread, which is what makes this safe to run at all: the worst case #41 worried
about was a re-import quietly replacing good ingredients with nothing, and a
script that cannot write an ingredient cannot do that. Each generated statement
guards itself twice as well - `remote_url` must still match the page the method
was read from, so a shifted id is a no-op rather than a wrong write, and
`method` must still be empty, so a method typed by hand since is never
overwritten. Both make the file safe to apply more than once.

**The generated file starts with `SET NAMES utf8mb4;`**, and needs to. Method
text is full of degree signs, accents and dashes; a mysql client defaulting to
latin1 reads those UTF-8 bytes as latin1 and stores them double-encoded -
`180°C` arriving as `180Â°C` - with no error anywhere. This was caught by
comparing `MD5(method)` against the generator's own hash rather than by reading
the output, which looked perfectly fine.

## Taking a full backup: `scripts/backup-prod.sh`

`sync-from-prod.sh` pulls *your account's* data into local dev. It is not a
backup - it skips `user`/`account`/`account_user` entirely and only takes one
account's recipes. For an actual backup of everything:

```bash
scripts/backup-prod.sh
```

Prompts for the same connection details, then writes a compressed logical dump
to `~/big-shop-backups/bigshop-<timestamp>/` - one schema file and one data
file per table, the same layout as the older dumps in `backups/`.

**It uses Dumpling, not BR.** BR is the tool people reach for and it cannot work
against TiDB Cloud: it needs network access to every PD and TiKV node, which
TiDB Cloud does not expose, and PingCAP's docs state plainly that manual backups
are unsupported on serverless instances. BR's `local://` storage is also a trap
- it writes to each TiKV node's own disk, not to the machine running the
command. Dumpling connects over the ordinary MySQL protocol port, so it works
unchanged.

**The output deliberately lands outside the repository.** A full backup contains
the `user`, `account_user` and `invite` tables: real email addresses, Auth0
subject ids and invite tokens. `backups/` is tracked in git and already holds
seven users' email addresses from 2024, which is enough of that. The script
refuses to write anywhere inside the working tree.

Three knobs, all env vars: `BACKUP_ROOT` to change the destination,
`CONSISTENCY=none` if the instance rejects Dumpling's default snapshot read, and
`CA_FILE` if you ever need a private CA.

**A Docker Desktop trap worth knowing**, since the first version of this script
hit it: don't bind-mount the host's `/etc/ssl/cert.pem` into the container. On
macOS `/etc` is a symlink to `/private/etc`, which is not a shared path - Docker
silently creates an empty *directory* at the mount target instead of failing,
and Dumpling then reports `could not read ca certificate: read /ca.pem: is a
directory`. Mounting the resolved `/private` path is refused outright. The
script uses the CA bundle already inside the container, which verifies TiDB
Cloud's Let's Encrypt certificate; `CA_FILE` is copied into the output directory
rather than mounted, because that directory is already known to be shareable.

