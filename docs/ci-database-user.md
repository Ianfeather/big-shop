# The CI database user

`.github/workflows/deploy-api.yml` applies pending migrations before every
deploy (see [`internal/pkg/migrate`](../api/internal/pkg/migrate/migrate.go)).
That step needs a database credential, and this is how to create one that is
not `root`.

## Why not root

The credential lives in a GitHub repository secret, which is a different
security posture from a password typed on a laptop: it is used unattended, by
any workflow run on the default branch, and its blast radius is whatever the
account can do. `3of82tmdiXMHzuo.root` can do everything to every schema,
including creating more users and reading data the migration runner never
touches.

Nothing the runner does needs that. Its privileges are knowable exactly,
because the set of statements it can execute is the set of statements in
`migrations/*.sql` plus three of its own, so the grant below is derived rather
than guessed.

TiDB Cloud's built-in roles do not fit: `role_readwrite` is DML only and cannot
run a migration, and `role_admin` is root again under another name.

## Creating it

Run this as `root` in the [TiDB console SQL editor](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934),
or through the console's **SQL Users** page if you prefer a form.

**The username must start with the cluster's user prefix.** On TiDB Cloud
Starter every SQL user is `<prefix>.<name>`, which is why the existing account
is `3of82tmdiXMHzuo.root` rather than plain `root`. Omit it and the user is
created but cannot connect. The `.` also means the name must be quoted.

```sql
-- Pick a long random password; nothing here should be typed by a human twice.
--   openssl rand -base64 32
CREATE USER '3of82tmdiXMHzuo.gh_migrate'@'%' IDENTIFIED BY '<generated-password>';

-- Scoped to bigshop, and to what a migration actually does.
--
--   SELECT INSERT UPDATE DELETE  the runner reads and writes schema_migration,
--                                and 165 UPDATE / 104 DELETE / 46 INSERT
--                                statements across migrations/ rewrite rows
--   CREATE ALTER DROP            22 CREATE TABLE, 61 ALTER TABLE, 2 DROP TABLE
--   INDEX                        CREATE [UNIQUE] INDEX (see 044)
--   REFERENCES                   FOREIGN KEY clauses in ten migrations
--   CREATE VIEW                  015 creates recipe_usage_summary
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW
  ON `bigshop`.* TO '3of82tmdiXMHzuo.gh_migrate'@'%';
```

Deliberately **not** granted, and each for a reason:

| Not granted | Why |
| --- | --- |
| `GRANT OPTION` | The credential must not be able to widen itself. |
| `CREATE USER`, `SUPER`, `PROCESS`, `FILE`, `RELOAD`, `SHUTDOWN` | Cluster-level powers no migration uses. `PROCESS` would also expose other sessions' queries. |
| Anything on `*.*` | The grant stops at `bigshop`. |
| `CREATE` at the server level | Only `001_init.sql` runs `CREATE DATABASE`, and it will never run again — production is baselined well past it. A database rebuilt from nothing needs root for that one statement. |

Confirm what was granted, and that it is only this:

```sql
SHOW GRANTS FOR '3of82tmdiXMHzuo.gh_migrate'@'%';
```

## Telling GitHub about it

Both halves have to change together. The password alone is not enough: the
*username* comes from [`.env.tidb`](../.env.tidb), which names `root`, so a new
password with the old username authenticates root and fails.

```bash
gh secret set TIDB_PASSWORD --repo Ianfeather/big-shop      # prompts, no echo
gh variable set TIDB_MIGRATE_USER --repo Ianfeather/big-shop \
  --body '3of82tmdiXMHzuo.gh_migrate'
```

The variable is an override, not the source of truth: `.env.tidb` names the same
account, so the deploy still reaches it if the variable is ever cleared. That
ordering is deliberate — the fallback is the narrow account, never root.

A **variable**, not a secret, for the username: `.env.tidb` already tracks the
root username in git and argues why — these identify the instance, they do not
open it. Keeping it visible means a failed deploy says which account it tried.

`deploy-api.yml` passes `TIDB_USER` from that variable. `scripts/lib/tidb-env.sh`
only fills in values that are not already set, so the variable wins over
`.env.tidb` when present and nothing else has to change.

## Checking it works before merging anything

From a checkout, with Docker running and no Go needed:

```bash
TIDB_PASSWORD='<generated-password>' ./scripts/migrate-prod.sh --dry-run
```

No `TIDB_USER` needed: the script defaults to `.env.tidb`'s `TIDB_MIGRATE_USER`,
which names this account. It used to inherit `TIDB_USER` — root — so a rehearsal
run without an explicit override tested the wrong credential and passed for the
wrong reason. Export `TIDB_USER` to connect as somebody else deliberately.

Expected on a baselined, up-to-date production: `migrate: up to date; all N
migration(s) applied`. A privilege that is missing shows up here as a specific
`Error 1142 ... command denied to user`, naming the one to add — which is the
point of testing it with `--dry-run` rather than discovering it mid-deploy.

`--dry-run` still creates `schema_migration` if it is absent, so it exercises
`CREATE` as well as `SELECT`. It applies nothing.

## Rotating it

Same two commands as above with a new password, after:

```sql
ALTER USER '3of82tmdiXMHzuo.gh_migrate'@'%' IDENTIFIED BY '<new-password>';
```

There is no window to coordinate: the credential is used only by the deploy
step, which is not running between deploys.

## What this does not cover

The **API's own** runtime credential is still `root`, in `fly.toml`'s `[env]`
with the password as a Fly secret. That is the more valuable one to narrow —
it is reachable from the internet, it is long-lived, and it needs no DDL at all
(`SELECT, INSERT, UPDATE, DELETE` on `bigshop.*` would do). Narrowing it is a
separate change, because unlike this one it touches the running application and
wants a deploy to verify.
