# Local dev data: synthetic seed vs. your real production recipes

`npm run dev:full` (see `../scripts/dev-full.sh`) brings up a local MySQL
container. By default, the *first* time its data volume is created, MySQL
runs everything in `mysql-init/` automatically, which applies
`../migrations/*.sql` and then `mysql-seed/dev-seed.sql` - two small
synthetic recipes, just enough to exercise every page. That happens once per
volume - it doesn't re-run on every `docker compose up` (see `CLAUDE.md`).

Because it happens once per volume, a volume created before a migration was
added would otherwise go on serving a schema without it. `dev:full` therefore
runs `../scripts/ensure-db-current.sh` first, which notices and repairs that:
it dumps the volume's data (to `prod-dumps/pre-rebuild-<timestamp>.sql`),
recreates the volume so the init path replays every migration, and restores
the data on top. Silent and instant when there is nothing to do. **You should
not need to run `docker compose down -v` by hand**, and the sync described
below goes through the same check before it imports.

This doc covers the alternative: pulling in your own real recipes from
production instead of the two made-up ones.

## What `scripts/sync-from-prod.sh` does

One command, no arguments:

```bash
scripts/sync-from-prod.sh
```

It reads the connection details from `.env.tidb` and asks only for the
password (see "Connection details" below), then:
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

This is also why a rebuild by `ensure-db-current.sh` is not the data loss it
sounds like: this script already treats the local copy as disposable and
reproducible, and step 3 leaves a replayable dump on the host, outside the
volume. What a rebuild preserves that this script does not is local-only data
you made through the app.

## Before running it: find your account id

`migrations/012_user_account.sql`'s comment ("Swapping buzzfeed and personal
account") means whichever account id is *yours* may not be `1` in
production anymore. Confirm it first by running this in the TiDB Console
SQL editor (link in `CLAUDE.md`):

```sql
SELECT * FROM account_user;
```

Your row's `account_id` goes in `.env.tidb` as `ACCOUNT_ID`. It is the one
value that is *not* defaulted: leave it unset and the script asks rather than
assuming `1`, because assuming wrong would pull somebody else's recipes onto
your laptop.

## Connection details

`sync-from-prod.sh`, `check-orphans.sh` and `backup-prod.sh` share one source
of connection details: **`.env.tidb` at the repo root**, read by
`../scripts/lib/tidb-env.sh`. Every one of them asks for exactly one thing at
run time, the password.

```
TIDB_HOST=...        # no default - must be set
TIDB_USER=...        # no default - must be set
TIDB_PORT=4000       # TiDB Cloud's protocol port, not MySQL's usual 3306
TIDB_DB=bigshop
ACCOUNT_ID=          # sync-from-prod.sh only; unset means it asks
```

**`.env.tidb` is tracked in git**, like `.env.development` and
`.env.production`. Nothing in it is a secret: a hostname, a port, a username
and a database name *identify* the instance, they do not open it. Checking them
in is what makes these scripts a one-liner on a fresh clone instead of four
questions on every run. The password is the secret, and it is not in there.

Anything already exported in your environment beats the file, so a one-off run
against somewhere else needs no edit and nothing put back afterwards:

```bash
TIDB_HOST=some-other-gateway scripts/check-orphans.sh
```

Missing `TIDB_HOST` or `TIDB_USER` is a hard error naming what is missing -
they are deliberately not defaulted, because a script that silently connects
somewhere you did not mean is worse than one that refuses.

- **Host and username** are the same values the API itself uses, in
  `api/fly.toml`'s `[env]` block - `TIDB_HOST` and `TIDB_USER`, under those
  exact names. They used to have to be dug out of a
  `DSN` connection string in Netlify's environment UI; there is no such string
  any more, because `dsn.go` assembles the connection from these components and
  the `TIDB_PASSWORD` secret. See
  [technical-architecture.md](../technical-architecture.md#the-connection-string-and-why-nobody-writes-one).
- **Password** - never passed as an argument, never read from `.env.tidb` or
  from the environment, and stored nowhere. Each script prompts once, silently,
  and holds it in memory only for the container calls that need it, which
  receive it as an environment variable rather than on a command line where the
  host's process list would show it. A script whose stdin is not a terminal
  fails with that explanation rather than reading a line from whatever is piped
  in. Credential-injection tooling (1Password CLI, macOS Keychain) was
  considered and deliberately skipped for now - 1Password's seamless
  biometric-unlock flow is inherently host-bound and can't run purely in
  Docker, and the fully-containerized alternative (service account tokens)
  needs a compatible plan tier and a separate shared vault, which wasn't judged
  worth it yet.

`.env.tidb` is parsed, not `source`d. It holds credentials-adjacent
configuration, not code, and sourcing it would execute whatever ended up in it
- including a value pasted out of a console with a `$(...)` somewhere in it.
Next.js never sees the file either: `@next/env` loads `.env`, `.env.local` and
`.env.<NODE_ENV>`, and this is none of those.

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
the same access the app's own connection already relies on - so that's what this
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

`down -v` is also the only way to re-run migrations at all: the MySQL
entrypoint runs `docker-entrypoint-initdb.d` only when the data directory is
empty, so editing a migration and restarting the container does nothing.

## Collation: local now matches production

`migrations/040_charset_utf8mb4_bin.sql` brings every table to
`utf8mb4` / `utf8mb4_bin`. In production that is mostly about what can be
*stored* - four tables were `latin1`, which cannot hold a character outside
its 256, and seven were `utf8mb3`, which cannot hold a 4-byte one.

Locally it changes something else, and it is worth knowing about. A database
built from `migrations/*.sql` used to be uniformly `utf8mb4_0900_ai_ci` -
case- and accent-**insensitive** - while production has always been binary and
therefore **sensitive**. So `INSERT INTO ingredient (name) VALUES ('Garlic')
ON DUPLICATE KEY UPDATE id=id` (`service/recipe.go`) collapsed `Garlic` and
`garlic` into one row on a laptop and created two in production. Local now
behaves the way production does.

One thing that gets better as a result: `sync-from-prod.sh` imports production
rows into these tables, and any pair differing only by case was a
duplicate-key error against the old local collation.

## When the `db` container will not go healthy

`mysql-init/01-migrate-and-seed.sh` applies migrations with `--force`, which
skips a failing statement and still exits 0. Left alone that hides a broken
migration as a hole in the schema behind a Healthy container — a
collation-incompatible `CREATE TABLE consent_event` was skipped exactly this
way, and surfaced as a 500 from the consent endpoint that looked like an
application bug.

Every error the replay produces is now checked against
`mysql-init/expected-migration-errors.txt`, which names the few early
statements that cannot apply to an empty schema and explains each. Anything
else writes `ok = 0` to `bigshop._migration_status`, which is what the
healthcheck reads:

```bash
docker compose logs db | grep -A20 'not in expected-migration-errors'
docker compose exec db mysql -uroot -proot -e \
  "SELECT * FROM bigshop._migration_status"
```

The companion table is `bigshop.schema_migration`, one row per migration the
volume has actually had, with the SHA-256 of the file as it was applied. That
is the ledger `internal/pkg/migrate` reads, and it is the same table production
has — the healthcheck compares its rows against `./migrations`, and
`scripts/ensure-db-current.sh` reads it to decide whether a volume has fallen
behind. Which migrations a volume is missing:

```bash
docker compose exec db mysql -uroot -proot -N -B -e \
  "SELECT filename FROM bigshop.schema_migration ORDER BY filename"
```

Fix the migration — or add it to the allowlist with a note, if it genuinely
cannot apply from scratch — then `docker compose down -v && npm run dev:full`.

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
errors out against a database built from those migrations. TiDB declares **far
fewer foreign keys than those migrations do**, so the same statement can succeed
against production and leave the children dangling with no error at all.
Migration `029` did this: it deleted `thyme sprig` while an Ingredient Line
still referenced it, and Potato & Leek Soup silently lost its thyme. Nothing in
the test suite could catch it, because the tests run against MySQL.

That gap is also why the check does not trust declared constraints alone -
doing so would cover fewer than half the schema and still report clean.
`scripts/check-orphans.sql` unions the declared foreign keys with every column
named `<table>_id` whose table exists, so it covers relationships no constraint
was ever declared for. A run prints both counts for whichever database it is
pointed at - `declared_fks` and "Relationships checked" - and the second
exceeding the first is expected, not a fault.

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

Uses the same `.env.tidb` and asks only for the password, then writes a
compressed logical dump to `~/big-shop-backups/bigshop-<timestamp>/` - one schema file and one data
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

Three further knobs, all env vars, and none of them in `.env.tidb` because all
three are per-run rather than per-instance: `BACKUP_ROOT` to change the
destination, `CONSISTENCY=none` if the instance rejects Dumpling's default
snapshot read, and `CA_FILE` if you ever need a private CA.

**A Docker Desktop trap worth knowing**, since the first version of this script
hit it: don't bind-mount the host's `/etc/ssl/cert.pem` into the container. On
macOS `/etc` is a symlink to `/private/etc`, which is not a shared path - Docker
silently creates an empty *directory* at the mount target instead of failing,
and Dumpling then reports `could not read ca certificate: read /ca.pem: is a
directory`. Mounting the resolved `/private` path is refused outright. The
script uses the CA bundle already inside the container, which verifies TiDB
Cloud's Let's Encrypt certificate; `CA_FILE` is copied into the output directory
rather than mounted, because that directory is already known to be shareable.

