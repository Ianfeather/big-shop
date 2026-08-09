# Follow-ups

Small defects and doc-drift found while building `CONTEXT.md` from the codebase (2026-07-13). Not designed here — just flagged for later action.

Items 1–30, 32, 33, 36, 39, 40 and 48 have all been resolved — see [`follow-ups-resolved.md`](./follow-ups-resolved.md) for the full history (numbering preserved for cross-references between entries).

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

44. **Audit `Cache-Control` across the Go API.** Originally filed as "put cacheable pages
    and endpoints behind a CDN so we can globally distribute". Most of that premise
    dissolved on inspection, and what is left is a headers problem rather than an
    infrastructure one:

    - **The frontend is already fully CDN'd.** Netlify serves `.next` from its edge, and
      every route bar `/` is a client-rendered SPA behind an auth gate, so there are no
      cacheable *pages* beyond the marketing homepage and the hashed bundle.
    - **There is no CDN to add for the API either.** Once
      [`api-hosting-migration.md`](./specs/api-hosting-migration.md) lands, browser API
      traffic already crosses Netlify's edge via the `/api/bigshop/*` 200 rewrite, and
      Netlify's CDN *does* cache responses proxied from an external origin, honouring the
      origin's `Cache-Control`/`s-maxage`. Only the headers are missing. **Depends on that
      migration** for exactly this reason.

    Audit all 22 routes. Nineteen are account-scoped and mutable and want explicit
    `private`/`no-store`. Three take no account scoping and return the same bytes for
    everyone — and each wants a different answer, which is the finding:

    - **`/tags`** reads the `tag` table, a fixed list seeded by migration that no code path
      writes to (see `hooks/use-tags.ts`, which documents why nothing invalidates it). Long
      `s-maxage`, no purge needed.
    - **`/units`** is an Open catalog — saving a Recipe upserts every Unit its ingredients
      reference, so an import can coin `"bunch"`. Cache-tagged and **purged on write**,
      with a moderate backstop `s-maxage`.
    - **`/ingredients`** is read server-side by `lib/recipe-import/known-names.ts`, which
      post-migration calls Fly directly via `API_HOST_INTERNAL` and so **bypasses the edge
      entirely**. Edge caching buys it nothing; an in-process cache in that module is the
      real win, and is a separate piece of work.

    On the purge mechanism: Netlify supports `Netlify-Cache-Tag` plus a purge API on all
    plans, so this is available. It costs a Netlify personal access token as a Fly secret
    — a re-coupling to Netlify's control plane immediately after a migration that reduced
    it, accepted knowingly. **The purge must be async and best-effort: it must never fail a
    Recipe save.** Each tag can be purged only twice every five seconds before returning
    429, which a burst of saves, the e2e suite or a re-run of
    `scripts/backfill-recipe-method.mjs` can all exceed. The backstop `s-maxage` is what
    makes a dropped or rate-limited purge self-heal, which is why it is minutes rather
    than a year.

    **Accepted consequence: the three cached routes become publicly readable.**
    `Authorization` is not part of Netlify's default cache key and `Netlify-Vary` cannot be
    made to vary on it, so a `public` response cached from an authenticated request is
    served to whoever asks next, authenticated or not. That is acceptable here because the
    catalog is global and non-personal by design ([ADR-0001](./docs/adr/0001-global-ingredient-catalog.md)).
    **`public` must never extend to an account-scoped route** — one Account's Shopping List
    would be served to another.

    Finally, the near-miss worth recording because it would be misdiagnosed: a naive TTL on
    `/units` defeats the post-save invalidation at `components/recipe-form/Form.tsx:101`
    (asserted by `Form.test.tsx:201`). The client would dutifully refetch, hit the stale
    edge copy, and the new Unit would stay missing from autosuggest — looking exactly like
    a frontend cache bug, with the frontend innocent.

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

49. **Investigate why a request costs ~160ms per query, not ~90ms — and why `GET /shopping-list`
    issues nine of them.** Opened off the back of the Fly migration's latency measurement
    (see [ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md)'s Measured outcome).
    An investigation, not a fix: the numbers do not add up yet, and guessing which way they
    are wrong is how the wrong thing gets optimised.

    **What is known.** `GET /shopping-list` on the Lambda took ~1,624ms of server time and
    ~165ms on Fly. Counted from the code, that request makes **nine sequential DB round
    trips**:

    | Call | Queries |
    | --- | --- |
    | `GetRecipesFromList` | `GetAccountID` + 1 |
    | `GetIngredientListItems` | `GetAccountID` + 1 |
    | `GetExtraListItems` | `GetAccountID` + 1 |
    | `GetUnitCatalog` | 1 |
    | `GetIngredientCatalog` | 2 |

    No N+1 loops — every one is a flat query. Two things fall out:

    - **`GetAccountID` is resolved three times per request**, from the same `userID`, to get
      the same answer. Transatlantic that was ~270ms of pure waste; from Frankfurt it is
      small but still free to remove. Resolving it once in the handler and passing it down
      is the obvious change, and it touches every service function's signature, which is why
      it wants deciding rather than doing on impulse.
    - **The arithmetic does not close.** ADR-0006 assumed ~90ms a round trip, so nine
      queries predicts ~810ms — but the Lambda spent ~1,624ms. Something accounts for the
      other ~800ms, and it is not query count.

    **The leading hypothesis is connection establishment, not queries.** TiDB Serverless
    requires TLS, so a new connection costs a TCP handshake plus a TLS handshake — three to
    four round trips, ~270–360ms transatlantic, before a single query runs. `main.go` sets
    no pool limits at all, so `database/sql` defaults apply (`MaxIdleConns` 2), and every
    cold Lambda container built a fresh pool and `Ping`ed during `init()` — a consequence
    ADR-0006 already names. Whether a *warm* container was still paying handshakes, and how
    often Netlify recycled them, is exactly what nobody knows.

    **What would settle it**, cheapest first:

    - `observability.md`'s tracing, once it lands. A span per query against a span for the
      request answers this directly and permanently, with no bespoke work — which is the
      argument for simply waiting rather than investigating now.
    - `db.Stats()` on the Fly process (`OpenConnections`, `Idle`, `WaitCount`) exposed on a
      debug route or as a metric. Cheap, and tells you whether the pool is actually being
      reused now that the process is long-lived.
    - Explicit `SetMaxOpenConns` / `SetMaxIdleConns` / `SetConnMaxLifetime`. Currently
      unset, which was defensible when every container was short-lived and is now just
      undecided. Note TiDB Serverless has its own connection ceiling, so this is a real
      choice, not a formality.

    **Deliberately not urgent.** At 165ms the endpoint is fine, and the migration already
    took ~90% of the cost out. This is filed so the *reason* is understood before anyone
    reaches for caching (#44 reasons about a query profile that had never been measured) or
    concludes that query count was the problem. The interesting finding is that the biggest
    win came from something other than the mechanism the ADR predicted.

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
