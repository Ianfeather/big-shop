# The reporting database user

Three scripts in `scripts/` only ever read production:

| Script | What it does |
| --- | --- |
| [`check-charsets.sh`](../scripts/check-charsets.sh) | reads `information_schema`, then scans text columns for damage |
| [`check-orphans.sh`](../scripts/check-orphans.sh) | reads `information_schema`, then counts rows across every relationship |
| [`sync-from-prod.sh`](../scripts/sync-from-prod.sh) | `mysqldump` of one account's rows into the local dev database |

They connected as `3of82tmdiXMHzuo.root`, because that is what
[`.env.tidb`](../.env.tidb)'s `TIDB_USER` names and they had no reason to ask
for anything else. This is how to give them an account that cannot write.

Its siblings are [`api-database-user.md`](./api-database-user.md) and
[`ci-database-user.md`](./ci-database-user.md). This is the third and last of
the three, and the smallest.

## Why this one is worth less than the other two, and still worth doing

Being honest about the size of the win is the point, because it is the thing
that decides whether a fourth account is worth its rotation cost.

The API's credential and the deploy's credential were narrowed first, and they
mattered: both are **unattended**. One sits in a Fly secret behind a service
reachable from the internet, the other in a GitHub secret usable by any workflow
run on the default branch. Each is a stored, long-lived thing an attacker could
find and use.

This one is not like that. `scripts/lib/tidb-env.sh` is explicit that the
password is read from neither the environment nor a file — it is typed, at a
prompt, on every run, and lives only in that shell's memory. **There is no
stored credential here to steal.** So narrowing it closes no hole of the kind
the other two closed.

What it does buy is real but smaller:

- A mistyped or mispasted statement during a reporting session **cannot write**.
  These scripts print SQL and take SQL; a paste into the wrong terminal is the
  realistic accident, not an attacker.
- A laptop compromised *during* one of those sessions yields a read, not a
  write.
- The connection stops being a root connection, so `SHOW PROCESSLIST` on the
  cluster and any audit of who-did-what stops attributing routine reporting to
  root.

It also removes the last routine use of root in the repo, which is worth
something on its own: root's remaining callers become the two that genuinely
need it (`backup-prod.sh`, `probe-charset-conversion.sh`), and a root prompt
becomes an unusual event rather than the daily default. A credential you use
every day is one you stop noticing.

**The counter-argument, recorded because it is not silly.** Four production
accounts (`root`, `api`, `gh_migrate`, `reporting`) is a lot for a project this
size, and every account is another thing to rotate. Rotation that does not
happen is its own risk, and a stale password on a narrow account is worse than
a fresh one on a broad account. The reason this still comes out in favour is
that this account is the cheapest of the four to rotate — see
[Rotating it](#rotating-it): it has no consumer to coordinate with, no deploy to
time, and no outage if it is wrong.

## What it may do, and why exactly that

```sql
GRANT SELECT ON `bigshop`.* TO '3of82tmdiXMHzuo.reporting'@'%';
```

One privilege, one schema. **This was established by running the three scripts'
actual queries under exactly that grant, not derived by reading them** — the
board item that proposed this account expected `LOCK TABLES` and `PROCESS` to be
needed as well, and neither is.

What the rehearsal showed, point by point:

| Thing that might have needed more | Verdict |
| --- | --- |
| `information_schema.TABLES` / `COLUMNS` / `KEY_COLUMN_USAGE` | `SELECT` on `bigshop` is enough. A user sees the metadata of objects it holds a privilege on, which is exactly the schema these scripts ask about. |
| `@@character_set_database`, `@@collation_database`, `VERSION()` | Session and server variables need no privilege at all. |
| `mysqldump --skip-lock-tables` | No `LOCK TABLES` needed. The flag was already there for an unrelated reason: TiDB's `SAVEPOINT` support does not match MySQL's, so `--single-transaction` fails outright, and TiDB is MVCC-based so an unlocked read is no less consistent. |
| `mysqldump` tablespace DDL | **Needs `PROCESS`, so it was removed instead** — see below. |
| `--where="... IN (SELECT ...)"` subqueries | Plain `SELECT`. |

### The one thing that had to change: `--no-tablespaces`

`mysqldump` 8.0 reads `INFORMATION_SCHEMA.FILES` to emit tablespace DDL, and
that needs the cluster-level `PROCESS` privilege. Without it:

```
mysqldump: Error: 'Access denied; you need (at least one of) the PROCESS
privilege(s) for this operation' when trying to dump tablespaces
```

The trap is that **it then carries on and exits `0`**, having written a complete
and correct data-only dump. So this was never going to break `sync-from-prod.sh`
— it would have printed an alarming error on every single run that meant
nothing, which is how people learn to ignore stderr.

Granting `PROCESS` would have been the wrong fix. It is cluster-wide rather than
scoped to `bigshop`, and it exposes every other session's running queries;
`ci-database-user.md` already refuses it to the migration account for that
reason. And there is no tablespace DDL worth dumping here anyway, since
`--no-create-info` means the dump carries no DDL at all.

So `sync-from-prod.sh` passes `--no-tablespaces`, and the grant stays at one
privilege.

Deliberately **not** granted:

| Not granted | Why |
| --- | --- |
| `INSERT`, `UPDATE`, `DELETE` | The entire point. These three scripts write nothing. |
| Any DDL | `probe-charset-conversion.sh` is the script that runs `ALTER`, and it keeps using root. |
| `LOCK TABLES`, `RELOAD` | A consistent full backup wants them; `backup-prod.sh` is not one of these three and keeps using root. |
| `PROCESS` | Above. Cluster-wide, and `--no-tablespaces` removes the only need for it. |
| `GRANT OPTION` | The credential must not be able to widen itself. |
| Anything on `*.*` | The grant stops at `bigshop`. |

## Creating it

Run as root in the [TiDB console SQL editor](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934).

**The username must carry the cluster's prefix.** On TiDB Cloud Starter every
SQL user is `<prefix>.<name>`; one created without it exists but cannot connect.
The `.` also means the name has to be quoted.

```sql
-- Pick a long random password; nothing here should be typed by a human twice.
--   openssl rand -base64 32
CREATE USER '3of82tmdiXMHzuo.reporting'@'%' IDENTIFIED BY '<generated-password>';

GRANT SELECT ON `bigshop`.* TO '3of82tmdiXMHzuo.reporting'@'%';

SHOW GRANTS FOR '3of82tmdiXMHzuo.reporting'@'%';
```

Expected from `SHOW GRANTS`, and nothing else:

```
GRANT USAGE ON *.* TO `3of82tmdiXMHzuo.reporting`@`%`
GRANT SELECT ON `bigshop`.* TO `3of82tmdiXMHzuo.reporting`@`%`
```

`USAGE` is not a privilege; it is how MySQL and TiDB spell "this user exists".

## Verifying it

The account exists and [`.env.tidb`](../.env.tidb) names it in
`TIDB_READONLY_USER`, so the three scripts already connect as it. The quickest
confirmation is the password prompt itself, which names the account **before**
asking for anything — so it tells you which credential is about to be used
while there is still time to press Ctrl-C:

```
TiDB password for 3of82tmdiXMHzuo.reporting@gateway01.eu-central-1.prod.aws.tidbcloud.com:
```

Run the two cheap ones first; both are pure reads and safe against production at
any time:

```bash
scripts/check-charsets.sh
scripts/check-orphans.sh
```

A privilege that is missing surfaces as a specific `Error 1142 ... command
denied to user`, naming the one to add. An account created without the
cluster's `3of82tmdiXMHzuo.` prefix fails earlier and differently — it exists
but cannot authenticate at all, so the symptom is `Access denied for user`
rather than a privilege error.

Then the one that actually dumps, which is the only one exercising `mysqldump`
and therefore the only one that would notice a missing `--no-tablespaces`:

```bash
scripts/sync-from-prod.sh
```

## Rolling back

Comment the line out again:

```diff
-TIDB_READONLY_USER=3of82tmdiXMHzuo.reporting
+# TIDB_READONLY_USER=3of82tmdiXMHzuo.reporting
```

`tidb_env_prefer_user` then finds nothing, falls back to `TIDB_USER`, and the
three scripts behave exactly as they did before this account existed. There is
nothing to coordinate and no window in which anything is broken, because nothing
stores this password and no unattended process uses it — which is the same
property that makes rotation trivial, below.

## Rehearsing it without touching production

The local stack carries the same grant, so a change to any of these three
scripts can be checked against it first — which is how the grant above was
arrived at.

[`docker/mysql-init/03-reporting-user.sql`](../docker/mysql-init/03-reporting-user.sql)
creates `bigshop_reporting` with `GRANT SELECT ON bigshop.*` and nothing else. A
fresh volume gets it from the MySQL entrypoint; an existing volume needs it
piping in once (`CREATE USER IF NOT EXISTS`, so repeating is harmless):

```bash
docker compose exec -T db mysql -uroot -proot < docker/mysql-init/03-reporting-user.sql
```

Then point a script at the local database instead of production. Everything
`tidb-env.sh` reads can be overridden from the environment, so this needs no
edit to `.env.tidb` and leaves nothing to put back:

```bash
TIDB_HOST=host.docker.internal TIDB_PORT="${DB_PORT:-3308}" \
TIDB_USER=bigshop_reporting TIDB_DB=bigshop \
  scripts/check-orphans.sh
```

`host.docker.internal` rather than `127.0.0.1` because the `mysql` client runs
inside a throwaway container, so "localhost" there is the container, not your
machine. The password is `bigshop_reporting`; local credentials are not secret.

Note that this exercises the **privilege set**, which is the thing worth
rehearsing, against MySQL 8.0 rather than TiDB. It will not reproduce TiDB's own
quirks — the `SAVEPOINT` incompatibility behind `--skip-lock-tables`, or its
smaller set of declared foreign keys. Those still need production to observe.

Unlike `02-api-user.sql`, this is **not** re-applied by `scripts/dev-full.sh`:
nothing in dev or e2e connects as this account, so it guards nothing
continuously and paying a statement on every dev start for a rehearsal aid would
be the wrong trade.

## Rotating it

```sql
ALTER USER '3of82tmdiXMHzuo.reporting'@'%' IDENTIFIED BY '<new-password>';
```

That is the whole procedure, and this is the account where that sentence is
true. There is no secret to update, no deploy to coordinate, and no window
during which something is broken, because **nothing stores this password**: it
is typed at a prompt by whoever is running the script, so the next run simply
uses the new one. Compare `api-database-user.md`, where the same rotation is a
staged Fly secret timed against a deploy to avoid an outage.

That asymmetry is the answer to "is a fourth account worth the rotation
burden?" — this is the one that adds least to it.

## What this does not cover

`backup-prod.sh` and `probe-charset-conversion.sh` still connect as root, and
should. A consistent full logical backup wants `LOCK TABLES` and `RELOAD`, and
probing charset conversions genuinely needs `ALTER` — neither belongs in an
account whose purpose is that it cannot change anything. Splitting them further
would mean a fifth and sixth account for two scripts that are run rarely and
deliberately, which is where narrowing stops paying for itself.
