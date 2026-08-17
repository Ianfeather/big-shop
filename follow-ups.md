# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30, 32, 33, 36, 39, 40, 44, 48, 49, 53, 56 and 58 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

Items 34 and 35 have moved to [`known-issues.md`](./known-issues.md): they are real but deliberately not being fixed, so they are not queued work.

31. **Buying preference: prefer fresh fruit over bottled juice.** For when automated
    buying exists. A Recipe asking for lemon juice, lime juice or orange juice should be
    satisfiable by buying the fruit rather than a bottle, as a user-level preference
    rather than a hard rule.

    The catalog already models most of what this needs, which is why it is worth writing
    down now rather than discovering later. `lemon juice` has a Base Unit of millilitre,
    and a Unit Size on a whole `lemon` records how much juice one fruit yields — that is
    the same mechanism that lets "3 onions" combine with "150g onion" (see CONTEXT.md's
    Unit Size). So the conversion "45ml lemon juice" -> "1 lemon" is already expressible;
    what is missing is a link saying *this Ingredient can be produced from that one*, and
    a preference saying which side to buy.

    Deliberately not a merge. `lemon` and `lemon juice` are different Ingredients and
    should stay so — the recipe genuinely wants juice, and a shopper buying for a recipe
    that needs lemon zest as well needs the fruit. The preference belongs at buying time,
    where it can be turned off, not baked into the catalog where it cannot.

    Worth checking when this is picked up: whether the yield Unit Sizes actually exist on
    `lemon`, `lime` and `orange` yet, since `030` merged `freshly squeezed lemon juice`
    into `lemon juice` but did not add any.

37. **Threshold-based alerting, once there are baselines to set thresholds from.**
    Deliberately deferred when the observability stack was designed (see
    [ADR-0007](./docs/adr/0007-observability-otel-grafana-cloud.md)): alert thresholds picked
    before anyone knows Big Shop's actual error rate and latency distribution are usually
    wrong in both directions, and on a project with an on-call rota of one person, an
    alert that has been learned-to-ignore is worse than no alert.

    Two rules are wanted, both symptom-based rather than cause-based:
    - **Backend 5xx rate** above a floor, across `bigshop-api` and `bigshop-web` together.
    - **Frontend error rate spike** from Faro.

    Explicitly *not* wanted as alerts, however tempting: DB latency, cold-start frequency,
    per-endpoint p99 regression, LLM failure rate, OpenAI spend. Those are causes you look
    at on a dashboard *after* something fires, not things that should wake anyone up.

    **The trigger is data, not a date** — roughly two weeks of production telemetry, i.e.
    enough to know what a normal day's error rate and p99 look like. Nothing here is
    blocked on more instrumentation; the traces, metrics and logs it needs all land with
    the initial work.

    Not deferred, and already shipped alongside the instrumentation: the synthetic
    uptime check on `/health`, plus the fix making `/health` actually query TiDB rather
    than unconditionally writing `ok`. That one is a binary up/down signal, so "wait for
    baselines" never applied to it.

38. **`/dave` is still on the pre-redesign design.** Split out of #36, which put the brand
    back into the Shopping List but deliberately left Dave alone. It kept its white card
    and its own blue palette (`--color-info`) through the "Cookbook" redesign and now
    looks like a different product — more so than before, since `/list` has moved again
    since.

    What #36 settled that this should follow: paper rather than a white card, purple for
    the controls you touch and for anything selected, lowercase `--font-heading` section
    headings rather than letter-spaced small caps, and terracotta reserved for those
    headings. The open question is what happens to `--color-info` itself: it exists only
    for Dave's chat UI (see its note in `pages/dev/design-system.tsx`), so this pass
    either finds it a real role or deletes the token.

    Note from Ian: I think it makes more sense to make dave a modal or integrate it into the other pages rather than it being its own page.

41. **Backfill the Method on existing Recipes — the 80 with no page to re-read.**
    Reduced rather than resolved. The automatable half is done: `scripts/backfill-recipe-method.mjs`
    re-read every Recipe carrying a `remote_url` through the app's own URL Import
    path and generated [`migrations/031_backfill_recipe_method.sql`](./migrations/031_backfill_recipe_method.sql),
    **56 methods**, verified byte-exact against a local copy of production and applied
    to production on 2026-08-06. See `docker/README.md` for how to run it. What is left
    is what no script can reach:

    - **68 Recipes have no URL at all**, and no source but the cook. Six of those use
      `remote_url` for a cookbook rather than a link ("From the Pie Room cookbook",
      "Deliciously Healthy Fertility by Ro Huntriss"), which is a source, just not a
      fetchable one. Every one of the 68 is listed by name in 031's footer.
    - **12 have a URL that could not be read** — dead links, paywalls and bot
      protection, one page (Yorkshire Puddings) that genuinely carries no method.
      Also listed by name in 031's footer, with the reason for each. Worth a second
      look before hand-typing: some may be fixable in the extractor rather than in
      the catalog, the way #40 was.

    Re-running the script is the right move after any extractor improvement — it is
    safe to run repeatedly, only ever writes to a `method` that is still empty, and
    will simply pick up whatever has become readable since.

    Still open, and still separate: `parseMethodSteps` in `components/recipe/index.tsx`
    splits "1. … 2. …" prose into steps at render time. 031 has now written 56 methods
    in exactly that shape, so the stopgap is more load-bearing than it was — which
    sharpens the question of whether steps should be stored as structured data, rather
    than settling it.

42. **Onboarding: the empty account, not the pitch, is what loses people.** Raised while
    reviewing the marketing page (2026-08-06). The page itself now says the right things,
    but the funnel behind it is: read the page → sign up through Auth0 → land in an
    account holding **nothing**. Every claim the page makes — the adding-up, the aisle
    order, "2 tins" — needs several Recipes to be visible at all, so the first session
    delivers none of it and asks for data entry instead. No amount of copy fixes that;
    this is where the work is.

    A bucket rather than a single task. Two concrete pieces are worth doing first:

    - **Let someone import a recipe before they have an account.** A URL box on the
      logged-out homepage that runs the real extractor and shows what came back — name,
      ingredients, method — with "save it" as the thing that triggers signup. It answers
      the biggest unspoken objection ("will it work on the sites *I* use?") by letting
      them test it rather than be told, and it means the first thing in the account is a
      recipe they chose. `pages/api/parse-recipe-url.ts` already does the work; what is
      missing is an unauthenticated path to it and, necessarily, rate limiting — it is an
      LLM call on a public endpoint, so this cannot ship without a per-IP cap and a
      sensible cost ceiling. It also needs a real failure state rather than silence: #40
      is fixed, but #41 found 12 URLs the extractor still cannot read (dead links,
      paywalls, bot protection), and a public try-it box that returns nothing at all for
      one of those is worse than no box — it reads as "this doesn't work" on the one
      screen where that conclusion is fatal.
    - **Never show an empty collection.** Seed a new Account with a small set of good
      Recipes — clearly marked as samples, deletable in one action — so the very first
      thing a user can do is tick three boxes and see a real combined list. The seeding
      mechanics already exist for local dev (`docker/mysql-seed/dev-seed.sql`); what does
      not exist is a production path, or a decision on where the sample Recipes come from
      and who owns them. Note the interaction with the Global Catalog: sample Recipes
      create real Ingredient Lines, so whatever is chosen should use Ingredients that are
      already well-curated rather than introducing new ones.

    Other onboarding threads not designed yet, listed so they are not re-discovered:
    what the first run of `/list` shows when nothing is selected; whether the invite flow
    should be offered during onboarding rather than buried in `/account`, given that a
    shared list is the strongest reason to keep using it; and whether the one-shot
    onboarding screen in `pages/index.tsx` (shown once, then marked onboarded in the
    background) is worth keeping at all if the two items above land — it currently exists
    only to say "you're in" to someone who has nowhere to go yet.

43. **Google Analytics, and the consent foundation it requires.** The other half of a
    decision already made: [`observability.md`](./specs/observability.md) puts long-horizon
    product questions ("is Dave used more than three months ago") explicitly out of scope
    for Grafana and names GA as their home — which is what makes Grafana Cloud Free's
    14-day retention a non-issue rather than a constraint. Nothing has been built.

    **Designed: [`specs/analytics-and-consent.md`](./specs/analytics-and-consent.md)**
    (2026-08-16). Four phases — policy/store/banner, the consent record, GA4 behind the
    gate, then the events. Two decisions were taken there rather than left open: the
    consent UI is **own-built** rather than a hosted CMP or an OSS library, and the
    consent record is **server-side and append-only** rather than client-only. The spec
    carries one question for sign-off before its Phase 2, which the notes below did not
    anticipate: consent is given on `/` while the visitor is anonymous, and the Go API
    has no unauthenticated write path at all (`/health` is its only carve-out), so
    whether an anonymous decision gets a server record is a genuine fork.

    **Unblocked.** Unlike the observability work, this depends on neither the Fly
    migration nor anything else. It is pure frontend and could ship first.

    One GA4 property covering **both** surfaces: the public marketing homepage (`/`) and
    the authenticated app. That scope is what drags in the compliance work below; a
    homepage-only install would not have needed it. It is also what makes this the
    measurement half of #42 — the funnel that item describes (read the page → sign up →
    land in an empty account) is not currently observable at any step, so there is no way
    to tell whether the onboarding work moved anything.

    Three parts, deliberately one item rather than three, because shipping the tag
    without the other two is the non-compliant version:

    - A **privacy policy page**. None exists today.
    - A **minimal consent banner**, two categories (essential / analytics). None exists
      today either.
    - **GA4 via Consent Mode v2**, firing only on opt-in. GA4 sets first-party cookies, so
      under UK PECR it is non-essential storage requiring opt-in — this is a real
      dependency, not a footnote.

    **Identity: `account.id` as a custom user property, and no `user_id`.** The Account is
    the unit the product questions are actually about ("how many Accounts have ever used
    Dave"), and sending it as a property answers them without asserting a cross-device
    person identity. The Auth0 subject is never sent to Google.

    This extends [ADR-0008](./docs/adr/0008-what-telemetry-does-not-carry.md)'s
    "pseudonymous identifiers, never content" rule to a second recipient, and the ADR
    should say so. Nothing leaks today — every `pageTitle` in
    `components/layout/index.tsx`'s callers is static (`"Recipes"`, `"Chat with Dave"`)
    and Recipe URLs carry numeric ids — but that is currently an accident rather than a
    rule. A future `{recipe.name} — Big Shop` title would ship Recipe names to Google.

    Events: page views plus a short fixed list — Recipe imported by Source, Shopping List
    generated, Dave turn, Invite sent. Two things to get right:

    - **Page views must be fired manually on Next router changes.** Every route bar `/` is
      a client-rendered SPA, so the default single pageload measures almost nothing.
    - **GA carries an event only when the question is longitudinal.** Otherwise it stays a
      Grafana metric. `observability.md` already specifies an import-outcome counter by
      source and result, and a duration histogram by route; duplicating those in GA is the
      obvious drift and this rule is what prevents it.

    **Faro is deliberately not gated by the banner.** Frontend error reporting stays always
    on, treated as necessary for service integrity. Recorded as a knowing risk rather than
    an oversight: the "strictly necessary" exemption is narrow and error monitoring is a
    contested fit. The alternative — putting Faro under the analytics category — would
    blind error reporting for everyone who declines, which is the thing `observability.md`
    exists to provide.

45. **The API's deploy gate does not include e2e.**
    `.github/workflows/deploy-api.yml` is gated on the `CI` workflow succeeding
    (`workflow_run`), which is what
    [`specs/api-hosting-migration.md`](./specs/api-hosting-migration.md)'s Phase 2 asked
    for. `e2e.yml` is a separate workflow that a `workflow_run` on `CI` cannot see, so
    merging requires all three checks while deploying the API requires only the CI ones.

    The gap is narrower than it first looks. Every commit reaching `master` goes through a
    pull request where every required check is green — a direct push is *rejected*, not
    merely ungated (see CLAUDE.md). What is left is this: the ruleset is not "strict", so
    the merge commit need not be the commit the suites ran against. `ci.yml` re-runs on
    that merge commit; `e2e` does not. So a semantic conflict between two independently
    green branches could deploy an API that e2e would have caught.

    Not fixed because the obvious fix is worse than the problem. `workflow_run` with
    `workflows: [CI, E2E]` fires when *either* completes, not both, so gating on both means
    the deploy job polling the other workflow's conclusion through the API and
    re-implementing a join GitHub does not offer. Cheaper options if this ever bites: make
    the ruleset strict (at the cost of rebasing on every unrelated push), or fold `e2e`
    into `ci.yml` as a second job, which would turn the whole thing into a one-line
    `needs:` — and would also mean updating the ruleset's job names.

46. **Account invites are a broken branch of the app.** Found while checking whether the
    Fly deploy would fail without `SENDGRID_API_KEY` (it does not — see below). Sharing an
    Account is, per CONTEXT.md, one of the product's reasons to exist, and right now the
    entry point to it returns an error.

    **What actually works.** The in-app half is complete and correct.
    `GET /invites` lists invites matching the logged-in user's *email*;
    `POST /invite/accept` re-checks token *and* email (`service.GetInvite`), disables the
    invitee's old Account, adds them to the inviter's, and deletes the invite;
    `components/invite/index.tsx` renders the card on `pages/index.tsx` and
    `pages/account.tsx`. So an invitee never actually needs the email — logging in is
    enough for the card to appear.

    **What is broken**, in the order it bites:

    - **`POST /invite` returns 400 whenever email sending fails**, which is currently
      always, since `SENDGRID_API_KEY` is set nowhere. Worse than a plain failure: the
      invite row is written *before* the send (`user.go:87`), and nothing rolls it back. So
      the inviter is told it failed, while the invite exists and would work if the invitee
      logged in. Decide which half is authoritative — most likely send-then-fail should
      degrade to "invite created, we couldn't email them" rather than a 400.
    - **The email's link is dead.** `user.go:100` points at
      `https://pleeyu7yrd.execute-api.us-east-1.amazonaws.com/prod/invitation/<token>`, an
      API Gateway stack from an architecture this app no longer has. Nothing serves it.
      Since acceptance is in-app and email-matched, the honest fix is probably a link to
      `https://www.bigshop.life` and letting the card do the work — or a real deep link if
      the token should survive the round trip.
    - **The sender is hardcoded** to `"Ian Feather" <info@ianfeather.co.uk>`
      (`user.go:94`). Whatever address is used has to be a verified SendGrid sender, so
      this and the key are one task, not two.
    - **`POST /invite/reject` does not scope to the caller.** `rejectInvite` calls
      `DeleteInviteByToken` with no check that the invite is addressed to the current
      user's email — unlike `accept`, which checks both. Any authenticated user with a
      token can delete someone else's invite. The token is 32 bytes so this is not
      urgent, but it is the one route in the family that trusts its input.

    **Not a deployment blocker.** `SENDGRID_API_KEY` is read once, per-request, inside
    `inviteUser` (`user.go:103`) — never at startup. Verified by booting the production
    image with the key absent: clean start, no restarts, `/health` 200, normal routes 200.
    So Fly deploys fine without it and only `POST /invite` is affected.

    Worth doing alongside #42 (onboarding), which notes that a shared list is the strongest
    reason someone keeps using Big Shop — an invite flow that errors on the first click is
    the same wound.

47. **Read the homepage marketing copy over by hand.** `pages/index.tsx` was rewritten in
    `aee9b58` ("Rework the marketing page around what it's actually for") and the copy has
    not had a careful human pass since. This is a note to do that deliberately, not a
    report of a specific defect — the wording is the one part of the app no test can check
    and the only part most visitors ever read.

    Worth reading for, roughly in order of how much it would cost to get wrong:

    - **Claims that have to stay true.** The Three ways in section promises "any recipe
      site", that a page "comes back as name, ingredients, method and tags", and that
      American cups and ounces are "turned into grams on the way in". #40's URL-import
      failures are fixed, but #41 found 12 URLs the extractor still cannot read, so "any"
      is doing load-bearing work. Decide whether it should be softened or left as the
      honest aspiration.
    - **What the empty first run actually delivers.** "The list builds itself" and "Start
      building your shopping list" both promise motion, and #42 records that a brand new
      Account has nothing in it — the pitch and the first screen disagree. These two items
      probably want settling together.
    - **"It gets better as more people cook"** describes the Global Catalog, which is a
      real property (see CONTEXT.md) but reads as a network-effect claim on a product with
      few users. Check it lands as the invitation it is rather than a boast.
    - **Voice.** The rest of the app settled on plain, lowercase, unexcited language during
      the Cookbook redesign; the headings here ("The fiddly bits", "What it's actually
      for") are in that register and worth keeping consistent if anything is rewritten.
    - Mundane but easy to miss: typos, the `&mdash;` entities rendering as intended, and
      whether the two calls to action ("Start building your shopping list", "Start with one
      recipe") should say the same thing.

    No code change is implied. If a rewrite does happen, `pages/index.tsx` is the only file
    involved, and nothing under test asserts on this copy.


50. **Email: Big Shop sends exactly one, and it doesn't work.** A placeholder so this isn't
    forgotten — **it wants a full spec of its own before any of it is built**, and nothing
    below is designed. The one email that exists today is the Account invite
    (`internal/pkg/app/user.go`, via SendGrid), and #46 records that it is broken end to
    end: no `SENDGRID_API_KEY` anywhere, a dead API Gateway link, a hardcoded sender. There
    is no welcome email, no lifecycle email, and no sending mechanism beyond that one
    inline call at request time.

    Two families, and they are genuinely different work — worth resisting the urge to
    build them as one thing:

    - **Lifecycle / marketing.** A welcome email, a top-tips email (what the product
      actually does well: URL import, the list adding itself, sharing an Account), and a
      series of acquisition/retention emails. These are scheduled rather than
      request-triggered, which is the part that does not exist at all: something has to
      decide "this Account signed up three days ago and has one Recipe" and send. No
      scheduler, no send log, no suppression list.
    - **Admin / transactional.** Forgotten password is the named example. **Audit before
      building**: there is no password-reset code in this repo — Auth0's Universal Login
      owns that flow entirely, so the audit is of the *Auth0 tenant*, not the codebase.
      What to check there: whether the connection is username/password at all or
      social-only (if social-only there is no forgotten-password to fix); whether the
      Change Password, Verification and Blocked Account templates are still Auth0's
      defaults; and critically whether the tenant is still sending from Auth0's shared
      dev mail provider, which is rate-limited and explicitly not for production. Also in
      this family: email change, Account deletion confirmation, and the invite itself
      once #46 lands.

    Things already known that constrain the eventual spec:

    - **The address is already stored.** `user.email` is upserted on user create
      (`service/user.go:11`), so there is a list; nobody has ever checked how complete or
      accurate it is.
    - **Sender identity is one task, not several.** #46 has to pick a verified sender and
      set the SendGrid key regardless; SPF/DKIM on `bigshop.life` and a single `From`
      identity should be settled once, there, rather than re-litigated per email type.
    - **Marketing email drags in the same compliance surface as #43** (privacy policy,
      consent). Under UK PECR the lifecycle family needs a lawful basis and a working
      unsubscribe in every send; the transactional family does not. That split is the main
      reason to keep them separate in the design.
    - **#42 is the reason the lifecycle emails would work or not.** A retention email
      pointing someone back into an empty Account is the same wound from a different
      angle — sequencing matters more than content here.

51. **Every Recipe Import fetches the whole Ingredient catalog across the Atlantic.**
    Opened by the `Cache-Control` audit (#44, resolved), which concluded that `/ingredients`
    is the one global catalog edge caching cannot help and named an in-process cache as
    "the real win". That conclusion was too quick, and this item deliberately reopens the
    question rather than inheriting it: the round trip is real, but an in-process cache is
    only one of three ways to remove it, and probably not the best.

    **What was actually verified**, by tracing every caller rather than by reading #44:

    - **`/ingredients` has exactly one consumer**: `fetchKnownNames` in
      `lib/recipe-import/known-names.ts`. The two browser hooks that used to read it
      (`use-ingredient-names`, `use-ingredient-metadata`) no longer exist — they went when
      the fetch moved server-side so the model would stop coining near-duplicates of names
      created moments earlier. Dave does not touch it.
    - **It runs on every ingredient-bearing import** — `/api/parse-recipe-url`,
      `/api/parse-recipe-text` and `/api/recipe-image`, skipped only for a method-only
      import.
    - **The path is transatlantic.** Those are Next.js API routes, so they run as Netlify
      functions, which [ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md)
      records as defaulting to `cmh` (US East, Ohio) with region selection paywalled. They
      call `API_HOST_INTERNAL` — the Fly origin in Frankfurt — *directly*, not through
      `www.bigshop.life`. So the hop is Ohio → Frankfurt → TiDB and back, which is the
      exact cost ADR-0006 moved the API to remove, reintroduced from the other side.
    - **The payload has no ceiling.** `GetAllIngredients` is `SELECT name FROM ingredient`
      — the entire global catalog, unscoped, unpaginated, growing monotonically as people
      import recipes ([ADR-0001](./docs/adr/0001-global-ingredient-catalog.md)).

    So the endpoint is not irrelevant — the data is what stops catalog fragmentation, which
    migration 029 exists to undo — but its shape is an artifact of the extractor living in
    a Netlify function while the catalog lives in Frankfurt.

    **Three fixes, in increasing order of how much they actually solve.** Pick one
    deliberately; they are alternatives, not stages.

    - **Route the call through `www.bigshop.life` instead of the Fly origin.** Then it
      crosses Netlify's edge like everything else and caches exactly like `/units` — and a
      hit is served from the Ohio PoP rather than Frankfurt, which is the whole latency
      problem gone. Cheapest by far: a host change plus the `public`/`s-maxage` header and
      a cache tag, and `internal/pkg/purge` already exists to invalidate it. Costs: a hop
      back through the platform the migration routed around; the catalog becomes publicly
      readable (the same trade already accepted for `/tags` and `/units`, fine under
      ADR-0001); and it needs purging on **every** Recipe save, since saves coin
      ingredients far more often than units. **Unverified assumption, and the thing to test
      first: that Netlify's CDN caches a response fetched by one of its own functions.**
    - **Cache in-process in `known-names.ts`** — what #44 proposed. Works, but the ceiling
      is lower than it looks: a module-level variable is only long-lived on a long-lived
      process, and this runs in a Netlify function, where a cold start starts empty and
      concurrent invocations do not share one. A short TTL is enough on correctness
      grounds — a stale list costs a near-duplicate name, not a broken import, and
      `extract.js` degrades honestly on an empty one.
    - **Move Recipe Import extraction into the Go API.** The structurally correct answer:
      co-located with the database, `fetchKnownNames` becomes a local query and
      `/ingredients` can be deleted outright. Much the largest change — the LLM calls,
      `OPENAI_API_KEY`, image upload and `formidable` all move — so it wants its own spec,
      and it is worth noting as the destination even if the first option is what ships.

    **Measure before building any of them.** Two numbers decide it: how long
    `fetchKnownNames` actually takes in production, and how often imports happen. If
    imports are rare, this is a round trip nobody is waiting on and the right answer is to
    do nothing. `observability.md`'s tracing would answer both directly — as with #49, the
    cheapest move may be to wait for it rather than to guess now.

52. **The Go API has no DB-backed test harness, so no handler and no query is tested.**
    Surfaced by the `Cache-Control` audit (#44), which wanted to assert that a Recipe write
    purges the `units` cache tag and could not: reaching `addRecipe`/`editRecipe` needs a
    database. The test that shipped, `TestRecipeWritesPurgeTheUnitsCache`, exercises the
    `purgeUnitsCache` helper instead, so **it would still pass if both call sites were
    deleted**. That is the concrete instance; the gap is general.

    **The size of it:** 37 exported functions in `internal/pkg/service` take a `*sql.DB`,
    and none has a test. Every Go test in the repo is either pure logic — combining,
    rounding, display units, quantity parsing — or uses the `fakeExecer` interface, which
    only covers the handful of `insert*` functions written to accept one. No `app` handler
    is tested beyond routing, auth and headers, all of which are deliberately chosen to
    need no DB.

    **What this is not.** It is not "the database path is untested": `e2e/` drives real
    Recipe CRUD and Shopping List flows through the real API against a real MySQL, and
    catches a great deal. The gap is narrower and worth stating precisely — nothing tests
    this code *at the Go level*, so:

    - a defect only surfaces as a UI symptom, and only on a path the UI actually drives;
    - error branches (`sql.ErrNoRows`, a failed insert mid-transaction) are unreachable
      from e2e and therefore untested everywhere;
    - anything with no visible surface is invisible. A purge that stops firing is exactly
      that: `/units` goes stale for five minutes and no test, at any level, notices.

    **Two shapes, and they are not equivalent.**

    - **A real DB, via `TestMain` against `docker-compose.yml`'s `db` service**, behind a
      build tag so `go test ./...` stays fast and Docker-free by default. Tests real SQL
      against the real schema, which is most of the value — the queries here are
      hand-written and the schema carries constraints (#4 added one). Costs: fixture and
      isolation discipline, and CI has to stand the container up. Note that
      `test:e2e:stop` passes `--volumes` precisely because a persisted volume silently
      pins the schema to whenever it was created; the same trap would apply here.
    - **`sqlmock`**, asserting the SQL a function issues. Cheap and hermetic, but it tests
      that the code sent the string you expected, not that the string is correct — of
      limited use for exactly the hand-written queries most worth covering.

    **Worth doing when something forces it, not before.** e2e covers the flows that matter
    today, and a harness with no tests in it is worse than none. The trigger is the second
    time someone wants to assert Go-level behaviour and cannot — the first time was #44.
    If it does get built, `addRecipe`/`editRecipe` purging the `units` tag is a good first
    test: it is the case that motivated it, and it has no coverage anywhere else.

54. **The Auth0 JWKS is re-fetched on every authenticated request.** Found while measuring
    #49 and arguably more important than what it went looking for. `getPemCert`
    (`netlify-functions/recipes/internal/pkg/app/app.go`) does a bare
    `http.Get(".../.well-known/jwks.json")` with no cache, and `go-jwt-middleware` v1 calls
    the `ValidationKeyGetter` once per request. Auth0's own guidance is to cache the key set
    and refresh on an unknown `kid`; v2 of the library ships a caching provider that does
    this, which is the likely fix.

    Measured against the real tenant: a request carrying a well-formed token costs ~15–18ms
    where one carrying no token costs ~2ms, on every request rather than the first. Go's
    default transport keeps the connection alive, so it is normally one round trip — but the
    idle timeout is 90s, and a quiet period costs the full TCP+TLS reconnect (~140ms
    measured, and it was a transatlantic ~350ms on the Lambda).

    Three reasons it is worth fixing beyond the milliseconds:

    - **It is an availability coupling nobody chose.** Big Shop's request rate is its JWKS
      request rate. If Auth0 rate-limits, slows, or has an incident on that endpoint, every
      authenticated request fails — not just logins.
    - **It is unauthenticated work.** Anyone who can send a syntactically valid token with
      the right (public) `aud` and `iss` makes the API perform an outbound HTTPS request.
      That is a cheap amplification primitive, and the audience/issuer values are in
      `fly.toml` and `.env.development` by design.
    - **It is on the critical path of every request**, ahead of the database, so it is pure
      serial latency on the endpoint #49 was measuring and on every other one.

    The related panic — a token whose `kid` matched nothing killed the request rather than
    returning 401 — was fixed alongside #49 rather than left here, since it was a defect
    rather than a design question. Fixing the caching should not reintroduce it: an unknown
    `kid` is exactly the case a cache must handle by refreshing and then *failing cleanly*.

    **Designed as Phase 1 of
    [`specs/completed/request-model-optimisations.md`](./specs/completed/request-model-optimisations.md)**,
    which is where the implementation detail lives. That spec's approach turned on one
    constraint — `go-jwt-middleware` **v2.3.0** was the last release declaring `go 1.23.0`,
    and this repo pinned Go 1.23 in four places. **That constraint is gone**: #91 moved the
    repo to Go 1.25, and the API now runs v2.3.1. Going further is #57.

55. **Photo Import's extraction runs after the response, and nothing establishes that a
    Netlify function stays alive to finish it.** `pages/api/recipe-image.ts` answers `202`
    with a job id and leaves `processImage`/`processMethodImage` running in a detached
    promise; the client then polls `GET /api/recipe-image?jobId=`. A Lambda's execution
    environment freezes when the handler returns, so whether that promise ever resolves
    depends on whether the platform's wrapper waits for the event loop to drain first —
    which is a property of `@netlify/plugin-nextjs`, not of this code, and was not
    established either way while instrumenting it in Phase 4 of
    [`specs/observability.md`](./specs/observability.md).

    Two further consequences if it does *not* wait, beyond the import silently never
    completing: the poll can land on a different container from the one holding the work,
    and the outcome telemetry added in Phase 4 (`bigshop.import.outcome` for the `photo`
    and `method-photo` Sources, and the token counter for the extraction call) is recorded
    and flushed in that same detached promise, so it shares the fate of the work it
    measures.

    Not fixed there deliberately: making the extraction reliable is a change to how Photo
    Import works — most likely a real queue, or doing the extraction inline and holding the
    request — not a change to how it is observed. **The counter going flat while Photo
    Import appears to work is the signal to come back here**, which is a better position
    than the one before Phase 4, where there was no signal at all.

57. **Upgrade `go-jwt-middleware` to v3.** Split off while removing the Go 1.23 version
    pins (see #54 and `specs/completed/request-model-optimisations.md`). Once #91 moved the repo to
    Go 1.25, three pinned dependencies came unstuck at once — `go-sql-driver/mysql` and
    Huma were straight version bumps and were taken there and then, but
    `go-jwt-middleware` v2 → v3 is a **major version**, so it is queued here rather than
    smuggled into an unrelated PR. The API sits at **v2.3.1**, the newest v2, in the
    meantime; nothing is blocked.

    It is a rewrite of the wiring, not a version swap:

    - **Constructors became options-based and now return errors.**
      `validator.New(keyFunc, RS256, issuer, []string{audience})` becomes
      `validator.New(WithKeyFunc(...), WithAlgorithm(...), WithIssuer(...), WithAudience(...))`,
      and both `jwks.NewCachingProvider` and `jwtmiddleware.New` gained an `error` return.
      `internal/pkg/app/app.go`'s `newJWTMiddleware` is the only place that has to change,
      which is the one piece of good news.
    - **The underlying JWT library changed** from `go-jose` to `lestrrat-go/jwx`. That
      reaches the tests: `TestKeyLookupFailureIsRefusedNotPanicked` mints its token with
      go-jose, so either go-jose stays as a test-only dependency or the fixture moves to
      `jwx`. It has already been rewritten once for the same reason (it used
      `form3tech-oss/jwt-go` before v2).
    - **Claims move out of `ContextKey{}`** and into `core.GetClaims[T](ctx)`, so
      `userMiddleware` changes too.

    Two things to check rather than assume, both of which the v2 work had to pin down:

    - **A missing token must still answer 401, not 400.** v2's `DefaultErrorHandler`
      answers 400, which is why `authErrorHandler` exists at all; `TestRefusalsAnswer401`
      guards it and must stay green.
    - **`CachingProvider`'s TTL semantics.** v2 caches the whole key set for the TTL and
      does not refresh on an unknown `kid` — an accepted limitation, argued against the
      tenant publishing two keys at once. v3 adds `WithCache` and
      `WithStrictJWKSURIOrigin`, so re-read that argument rather than carrying it over.

    Worth doing for more than currency: v3 validates the issuer **before** fetching the
    JWKS, explicitly to prevent SSRF. On v2 a token carrying an attacker-chosen `iss`
    reaches the key fetch first, which is the shape #54 flagged as "unauthenticated work"
    in the first place.

59. **There is no way to delete an Account, and GDPR requires one.** Raised alongside #43
    (2026-08-16), which builds the privacy policy that will have to describe this right
    while nothing implements it. Right of erasure is not optional and there is no partial
    version: today a user who asks to be deleted can only be served by hand, against
    production, with no runbook.

    **What exists**, and it is less than it looks:

    - **`service.DisableUserAccount`** (`service/account.go:99`) sets
      `account_user.enabled = false` for **every** row matching a user — no account
      scoping — and `GetAccountID`/`GetAccount` both filter on `enabled = true`, so the
      user is left able to log in and resolve to no Account at all. It is the closest thing
      to a deactivation that exists.
    - It has **exactly one caller**, and it is not a user-facing one: `app/invites.go:36`,
      disabling an invitee's *old* Account when they accept an invite to someone else's.
      So the one mechanism in the codebase that could deactivate somebody exists as a
      side effect of the invite flow.
    - **`service.RemoveUserFromAccount`** deletes an `account_user` row. That is membership,
      not erasure — every Recipe, list and ingredient stays exactly where it was.

    Nothing deletes a `user` row, a `recipe`, a `list`, or anything in Auth0.

    **The hard part is not the SQL, it is deciding what an Account is when it is shared.**
    Per CONTEXT.md a Recipe belongs to an *Account*, not a User, and an Account can have
    several Users — which is the product's reason to exist. So "delete my account" is
    genuinely ambiguous:

    - The last User of an Account leaving is unambiguous: the Account and everything under
      it goes.
    - A User leaving a *shared* Account is not. Their Recipes are the Account's Recipes and
      the other members are still cooking from them. Deleting them would erase someone
      else's data; keeping them means the departing user's contributions outlive their
      account, which they may well have meant to take with them. This wants a product
      decision before any code.

    **Things that have to be enumerated before this can be specced**, none of which are in
    the `recipe`/`list` tables everyone thinks of first:

    - **Auth0** holds the identity, and it is a separate deletion in a separate system with
      its own API. Deleting the DB rows alone leaves a working login for a deleted account.
    - **The Global Ingredient Catalog is deliberately shared and must not be touched**
      ([ADR-0001](./docs/adr/0001-global-ingredient-catalog.md)). Ingredient names coined
      during someone's imports are global; they are not personal data and erasing them would
      damage every other Account. Worth writing down because a thorough implementer will go
      looking for "their" ingredients.
    - **Telemetry.** Grafana holds `user.sub` and `account.id` on spans and Faro sessions
      (ADR-0008 §1). Retention is 14 days on the free tier, which mostly solves this by
      expiry rather than by deletion — but "mostly" needs checking against what an erasure
      request actually obliges, not assumed.
    - **GA4**, once #43 lands, holds `account.id` as a user property. Google offers a User
      Deletion API; whether it is reachable for a property keyed on a custom property rather
      than `user_id` needs verifying rather than hoping.
    - **`consent_event`**, the append-only table #43's Phase 2 creates, is the awkward one:
      it exists to *prove* consent, so erasing it destroys the evidence that the processing
      was lawful. The usual answer is to retain the consent record under the legal-obligation
      basis while erasing everything it refers to — but that is a decision to take
      deliberately, not a `DELETE` to forget.
    - **SendGrid** holds delivered invite emails, and `invite` rows carry email addresses,
      which ADR-0008 §1 singles out as real personal data.

    Also in scope, and cheaper: **data export**. Right of access is the same underlying
    question — what belongs to this person — answered in the other direction, so the two
    are best designed together even if only deletion ships.

60. **Audit for stored XSS, and write down why the safe paths are safe.** Raised while
    specifying #43 (2026-08-16), whose `page_title` rule turns on a related observation:
    the codebase is currently safe by *accident* in several places, and an accident holds
    only until someone reasonable changes something nearby.

    **The initial sweep is largely reassuring**, and this item is written knowing that —
    it is an audit to confirm and protect an invariant, not a report of a live hole:

    - **No `dangerouslySetInnerHTML` and no `innerHTML` anywhere** in `components/`,
      `pages/`, `lib/` or `hooks/`. React escapes its children, so every rendered Recipe
      name, ingredient name, note and Method is inert today.
    - **No markdown renderer in the dependency tree.** Dave's replies render as
      `{message.content}`, a plain React child (`components/dave-chat/index.tsx:71`) — so
      the highest-risk surface in the app is safe for the least durable of reasons, which is
      that nobody has yet asked for Dave to emit formatted output.
    - **`RecipeLink`** (`components/recipe/index.tsx:10-16`) is the one place user-supplied
      data becomes an `href`, and it guards with `link.match(/^http/)`, which does exclude
      `javascript:`. Note what the guard actually is, though: a prefix test, not a scheme
      test — worth tightening to `^https?:\/\//` while someone is looking at it.

    **What makes this worth a deliberate pass rather than a shrug** is the shape of the
    threat model, which is unusual and easy to under-rate:

    - **The stored content is not user-authored.** Recipe names, ingredient text and Method
      prose arrive from **LLM extraction of arbitrary third-party web pages** — URL Import,
      Photo Import, paste-a-recipe. So the injection source is not a Big Shop user attacking
      themselves; it is any page on the internet, laundered through a model that is
      explicitly trying to reproduce the page's text faithfully. Prompt injection and script
      injection are the same input here.
    - **It is shared.** An Account has several Users (that is the product), so content one
      person imports renders in another person's browser. That is the "stored" half of
      stored XSS, and it is the half that makes it worth more than a self-inflicted alert.
    - **`node-html-parser` consumes attacker-controlled HTML server-side** in the extractor.
      Not a render path, so not XSS — but it is the same untrusted input reaching a parser,
      and belongs in the same sweep.

    So the deliverables are: confirm the sweep above by hand rather than by grep; tighten
    `RecipeLink`'s scheme test; and — the durable part — **write the invariant down where
    it will be read**, i.e. that no rendering path in this app may introduce raw HTML, and
    that adding a markdown renderer for Dave or for Method is the change that would need
    sanitisation designed in rather than added after. Method is the likely trigger: #41
    already notes that 031 wrote 56 methods in "1. … 2. …" shape and sharpened the question
    of whether steps should be structured data, and a rich-text answer to that question is
    exactly where this bites.

    Worth checking in the same pass, since it is the same class and nothing covers it: what
    Photo Import accepts as an upload, and whether an SVG can reach a context that renders
    it rather than treating it as an image.
