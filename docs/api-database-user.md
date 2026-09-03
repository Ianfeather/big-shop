# The API's database user

The Go API connects to TiDB as `3of82tmdiXMHzuo.api`, declared in
[`api/fly.toml`](../api/fly.toml)'s `[env]` block with the password as a Fly
secret. It is not root, and this is
how to create, verify and rotate it.

Its siblings are [`ci-database-user.md`](./ci-database-user.md), the account the
*deploy* uses to apply migrations, and
[`reporting-database-user.md`](./reporting-database-user.md), the `SELECT`-only
account the read-only scripts in `scripts/` use. Separate credentials rather
than one is what lets each be small: the account serving the internet needs no
ability to change the schema, the account that changes the schema is not
reachable from it, and the account a person runs reports under can do neither.

## What it may do, and why exactly that

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `bigshop`.* TO '3of82tmdiXMHzuo.api'@'%';
```

Four privileges, one schema. Derived from the code rather than guessed: the
service layer issues 76 `UPDATE`, 71 `SELECT`, 47 `DELETE` and 36 `INSERT`
statements and **no DDL on any request-serving path** — no `CREATE`, `ALTER`,
`DROP`, `TRUNCATE` or `RENAME` outside `migrations/`. It reads no other schema,
touches neither `information_schema` nor `mysql.*`, calls no stored routine, and
takes no table locks. `ON DUPLICATE KEY UPDATE` needs `INSERT` and `UPDATE`,
both of which it has; transactions need no privilege at all.

What the absence buys, concretely: a defect that reaches the database — an
injection, a compromised container — cannot drop a table, add a column, read
another schema, create a user, or grant itself anything. It is confined to the
rows of one schema, which is the data it was already allowed to serve.

## Creating it

Run as root in the [TiDB console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934).
**The username must carry the cluster's prefix** — on TiDB Cloud Starter every
user is `<prefix>.<name>`, and one created without it exists but cannot connect.

```sql
CREATE USER '3of82tmdiXMHzuo.api'@'%' IDENTIFIED BY '<generated-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `bigshop`.* TO '3of82tmdiXMHzuo.api'@'%';
SHOW GRANTS FOR '3of82tmdiXMHzuo.api'@'%';
```

## Rolling it out without an outage

**`fly.toml`'s `TIDB_USER` and the `TIDB_PASSWORD` secret must take effect
together.** They are two halves of one credential, and either half alone is a
broken connection — the new username with root's password, or root's username
with the new password. Unlike the CI credential, getting this wrong is a
production outage rather than a failed deploy.

`fly secrets set` normally restarts the machine immediately, which would apply
the password while `fly.toml` still said root. `--stage` is the way out: it
records the secret without deploying, and the next deploy applies it alongside
the config change.

1. Create the user and grant, as above. Root stays valid throughout — **do not
   rotate root in the same change**; it is the rollback.
2. Stage the password:
   ```bash
   fly secrets set TIDB_PASSWORD='<generated-password>' --stage --app big-shop-api
   ```
   Nothing changes yet. `fly secrets list` shows it pending.
3. Merge the pull request carrying the `fly.toml` change. The deploy applies the
   new username and the staged password in one release.
4. Watch the deploy, then exercise the app — see below.

**Rollback is a revert plus a staged secret**, in the same shape: revert the
`fly.toml` line, `fly secrets set TIDB_PASSWORD='<root-password>' --stage`, and
deploy. Because root was never rotated, that returns the API to exactly its
previous state.

## Verifying it

The grant is exercised continuously rather than checked once. `docker/mysql-init/02-api-user.sql`
creates the same account with the same four privileges in the local stack, and
`docker-compose.yml` points `api` at it — so **every e2e run and every local dev
session runs under the production constraint**. A change that needs a fifth
privilege fails on a pull request, not in production.

That is the whole point of the local half. Without it, production would be the
only environment subject to the restriction, and the only one nobody can test —
which is precisely the shape of the incident that started all this: #133 shipped
a query for a column only production lacked, and no suite could catch it because
no suite ran against production's schema.

After deploying, exercise the routes that write, since a missing privilege shows
up on a write long before a read:

- Recipe create, edit, delete
- Shopping List generate, add extra item, mark bought, clear
- `POST /consent`, `PATCH /user/preferences`, `PATCH /user/onboarding`
- `POST /invite`
- **Account deletion**, which is the widest — `service.deleteAccountTx` writes
  across most tables in one transaction

One thing no click-through reaches: the hourly onboarding-email ticker
(`internal/pkg/lifecycle`) reads and writes on a schedule of its own. Its
statements are ordinary DML and so are covered, but it is the surface that would
stay silent longest if they were not.

## Rotating it

```sql
ALTER USER '3of82tmdiXMHzuo.api'@'%' IDENTIFIED BY '<new-password>';
```

then `fly secrets set TIDB_PASSWORD='<new-password>' --app big-shop-api` — no
`--stage` this time, because the username is not changing and an immediate
restart picks up the only half that moved.
