# Runbook: moving the Go API onto Fly.io

The operator half of [`specs/api-hosting-migration.md`](../specs/api-hosting-migration.md).
Everything in this file needs credentials or a live deploy, so none of it is in the PR
that carries the code — the code is inert until these steps run.

Decisions and rationale: [ADR-0006](./adr/0006-go-api-leaves-netlify-functions.md).

**Nothing here is urgent or irreversible until step 5.** Steps 1–4 stand up a second API
that no client is using. The Lambda goes on serving `/.netlify/functions/recipes` the
whole time, untouched, which is what makes step 5 revertible.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| A Fly.io account, `flyctl` installed (`brew install flyctl`), `fly auth login` | Steps 1–3 |
| The production `DSN` (TiDB connection string) | Step 2 — it's in Netlify's env vars today |
| The production `SENDGRID_API_KEY` | Step 2 — same place |
| Netlify dashboard access | Step 5 |
| GitHub repo admin | Steps 4 and 6 |

---

> **Every `fly` command below runs from `netlify-functions/recipes/`.** `--config` only
> relocates the config *file*; the app root and the Docker build context still come from
> the working directory. Running these from the repository root would make the whole repo
> the build context and look for a `Dockerfile` there, which does not exist — and
> `fly launch` would helpfully detect the Next.js app instead. This is the same directory
> `.github/workflows/deploy-api.yml` sets as its `working-directory`.
>
> ```bash
> cd netlify-functions/recipes
> ```

## 1. Create the app

```bash
fly apps create big-shop-api
```

Deliberately not `fly launch`. There is already a committed `fly.toml` and a `Dockerfile`,
so there is nothing to scaffold — and `fly launch` would run framework detection and offer
to rewrite the config, which is all downside here. `fly apps create` just registers the
name. It will ask which organisation to put it in if you belong to more than one.

The name is already `big-shop-api` in `fly.toml`, making the origin
`https://big-shop-api.fly.dev`. That hostname is also hardcoded in `netlify.toml`'s
rewrite, so if Fly refuses the name (they are globally unique), change **both** files
together.

## 2. Set the secrets

```bash
fly secrets set \
  DSN='<the production TiDB connection string>' \
  SENDGRID_API_KEY='<the production SendGrid key>'
```

`fly secrets set` normally triggers a release to roll the new values out; with no machines
created yet it simply stores them.

Only these two. `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` are public identifiers and are already
pinned in `fly.toml`'s `[env]` block — deliberately, because getting them wrong does not
fail loudly: with `AUTH0_DOMAIN` unset the JWKS fetch goes to `https:///.well-known/jwks.json`
and every authenticated route rejects while `/health` stays green.

**`DISABLE_AUTH` must never be set on this app.** It makes the API resolve every request to
a fixed dev user without validating a token.

Confirm with `fly secrets list` — it shows names and digests, never values.

## 3. Deploy and check it in isolation

```bash
fly deploy --remote-only
fly status
```

Then, against the Fly origin directly — no Netlify involved yet:

```bash
# Expect 200 and the bare string `ok` - healthHandler writes no JSON and sets no
# content-type. This is also what Fly's own health check hits.
#
# Use GET, not `curl -I`. The no-auth carve-out in app.go is `r.Method ==
# http.MethodGet`, so a HEAD falls through to the JWT middleware and comes back
# 401 on a perfectly healthy deploy. (fly.toml's check pins `method = "GET"` for
# the same reason.)
curl -i https://big-shop-api.fly.dev/api/bigshop/health

# Expect 401. A 200 here means auth is not running - stop and check the [env] block.
curl -i https://big-shop-api.fly.dev/api/bigshop/recipes

# Expect 200 and your real recipes. Grab a token from the browser: log into
# www.bigshop.life, open devtools > Network, copy the Authorization header off
# any /.netlify/functions/recipes request.
curl -i -H "Authorization: Bearer <token>" https://big-shop-api.fly.dev/api/bigshop/recipes
```

If the machine is up but every request hangs, it is almost certainly the DB: `fly logs`
shows the `init()` panic or ping failure. Both APIs talk to the *same* production TiDB, so
there is no data migration and no divergence — but it does mean a mistake here is visible
to real users' data. Read before you write.

## 4. Wire up the deploy pipeline

```bash
fly tokens create deploy
```

Add the output as a repository secret named `FLY_API_TOKEN`
(Settings → Secrets and variables → Actions). `.github/workflows/deploy-api.yml` fails at
its last step without it.

A deploy token is scoped to this one app — do not use a personal access token.

Test it: Actions → Deploy API → Run workflow. It always deploys `master`, whatever branch
you dispatch from.

## 5. Cut over

This is the only step users can notice. **Merge the migration PR first**, and confirm the
Netlify deploy went green. That PR carries both halves of the cutover: the rewrite in
`netlify.toml`, and the `lib/api-host.ts` code that makes `API_HOST_INTERNAL` mean
anything. Setting the variables against a deploy that predates it does nothing useful —
`API_HOST_INTERNAL` would be read by nobody, and the relative `NEXT_PUBLIC_API_HOST` would
break every server-side caller.

Verify the rewrite before touching any env var. Nothing is pointed at this path yet, so a
failure here costs nothing:

```bash
# Same three checks as step 3, but through www.bigshop.life. Same results expected.
curl -i https://www.bigshop.life/api/bigshop/health
curl -i https://www.bigshop.life/api/bigshop/recipes
curl -i -H "Authorization: Bearer <token>" https://www.bigshop.life/api/bigshop/recipes
```

Then the checks that specifically test the proxy rather than the origin:

- **Is it a rewrite, not a redirect?**
  `curl -si https://www.bigshop.life/api/bigshop/health | head -1` must be `200`, with no
  `Location` header and no change of URL. A `301`/`302` means `force = true` did not take.
  Note `-i` and not `-I`: see the GET-only carve-out above.
- **Does the response come back as JSON?** Netlify rewrites `Accept` to `*/*,image/webp` on
  the way through, and Huma content-negotiates on `Accept`. `*/*` resolves to JSON and this
  was verified against the container directly, but verify it through the real proxy too —
  a header the framework reads, mutated by an intermediary, is exactly the shape of bug
  `follow-ups.md` #12 records being caught only by e2e.
- **Do writes work?** A `PUT`/`PATCH`/`DELETE` through the proxy, not just a `GET`.
- **Is it actually faster?** Time a shopping-list generate for an account with a few
  recipes on it, against the Lambda doing the same. This is the whole point of the
  migration — ADR-0006 predicts 300–500ms. If it is not faster, stop and find out why
  before continuing.

Now change **two** values in Netlify (Site configuration → Environment variables), then
trigger a deploy:

| Variable | New value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_HOST` | `/api/bigshop` | Relative. Same-origin via the rewrite above |
| `API_HOST_INTERNAL` | `https://big-shop-api.fly.dev/api/bigshop` | **New.** Absolute, and must never gain a `NEXT_PUBLIC_` prefix |

Both are needed. A relative `NEXT_PUBLIC_API_HOST` works in the browser and nowhere else,
and three things call the API from inside a Netlify function — `lib/authenticate.ts`,
`lib/dave/tools.ts` and `lib/recipe-import/known-names.ts`. They read `API_HOST_INTERNAL`
and fall back to `NEXT_PUBLIC_API_HOST`, so if you set only the first they will each try to
`fetch('/api/bigshop/...')` from Node and fail outright.

`lib/authenticate.ts` is the one to watch: it is on the critical path of every
authenticated Next.js API route. If it breaks, `/api/recipe-image` and the parse routes all
start 500ing.

After the deploy, in a browser: load `/recipes`, open a recipe, edit and save it, add it to
the Shopping List, mark something bought. Watch the Network tab — requests should go to
`www.bigshop.life/api/bigshop/*`, not to `.netlify`. Then try a Photo or URL import, which
is what exercises the server-side consumers.

### Rollback

Set both variables back (`NEXT_PUBLIC_API_HOST` to
`https://www.bigshop.life/.netlify/functions/recipes`, remove `API_HOST_INTERNAL`) and
redeploy. The Lambda is still deployed and still registers its routes under
`/.netlify/functions/recipes` — `main.go`'s `lambdaBasePath` exists precisely so that
stays true. No Fly changes, no database changes.

## 6. Repo settings

**Add `go` to the `required checks` ruleset** (Settings → Rules → `required checks`). It
currently lists `build-lint-test` and `e2e` only, and the ruleset matches on job name, so
the new job gates nothing until you do.

This matters more than a missing gate. `deploy-api.yml` keys off the whole CI workflow's
conclusion, so a red `go` job merged through the un-updated ruleset silently stops the API
deploying while Netlify goes on shipping the site from the same commit — a frontend and an
API drifting apart, with no red required check anywhere to say so.

## 7. After the cooling-off period

Days later, once the Fly API has carried real traffic without incident, Phase 5 of the spec
is a separate PR: delete the `lambda.Start` branch and `lambdaBasePath` from `main.go`, drop
`aws-lambda-go` and `aws-lambda-go-api-proxy` from `go.mod`, remove `GO_VERSION` from
`netlify.toml`, rename `netlify-functions/recipes/` to `api/`, and fix the CORS config
(`app.go` pairs `AllowedOrigins: {"*"}` with `AllowCredentials: true`, which the CORS spec
forbids, so it does not do what it looks like it does).

**Merging that PR is what makes rollback stop working.** Do not do it on the same day.
