# Automatically ordering the Shopping List from a UK supermarket — research findings

**Status:** Research only. No code written, nothing decided.
**Date:** 2026-07-28, extended 2026-07-29 to cover the whole retailer landscape.
**Method:** Hands-on exploration of seven UK grocery sites (all unauthenticated) via
browser automation and plain HTTP, plus a read of the Big Shop Shopping List
implementation.

> **If you read one thing, read §9.** Tesco was the wrong first target. Ocado and
> Morrisons are dramatically more open — no bot wall on reads, structured product data
> including pack size and stock status, an anonymous basket, terms that *permit*
> personal-use ordering, and better search relevance. Parts 0–8 are the Tesco deep-dive
> that established the evaluation criteria; §9 applies them across the field.

---

## 0. Read this first: the blocker that outranks all six obstacles

*(This section is about **Tesco specifically**. See §9 — it does not generalise; Ocado's
terms are materially different.)*

Tesco's General Terms & Conditions contain an explicit, recently-worded prohibition.
Verbatim, from <https://www.tesco.com/shop/zone/general-terms-and-conditions>:

> Prohibited automated access: you must not use any automated system, software, or
> process (including bots, crawlers, scrapers, or AI tools) to access, extract, or
> collect data from this Site for any purpose without our prior written consent.

This is not boilerplate that happens to catch us by accident — "AI tools" is called
out by name, and the clause covers *access*, not just bulk extraction. The feature as
described is squarely inside it.

It is also **actively enforced**, not just asserted (see §2): Tesco runs Akamai Bot
Manager, and a plain `curl` — even with a browser User-Agent — gets a `403` from the
Akamai edge for *every* URL including `/robots.txt`. Only a real browser gets through.

And there is no sanctioned alternative: Tesco has **no public ordering API**. The old
Tesco Labs developer portal is unmaintained and stopped issuing subscriptions; what it
did offer was product/pricing data, never order placement.
([IT Pro](https://www.itpro.com/607668/online-grocery-shopping-gets-the-tesco-api-treatment),
[Tesco Labs devportal](https://devportal.tescolabs.com/))

### What this means practically

There are three postures, and they are genuinely different:

| Posture | Description | Assessment |
|---|---|---|
| **A. Server-side fleet** | Big Shop runs headless browsers in the cloud that log in as users and drive tesco.com | Requires defeating Akamai to work at all. Don't build this. It's the clause's central target, it needs active evasion, and it puts *users'* Tesco accounts at risk of suspension, not just ours. |
| **B. Local assistant** | Automation runs on the user's own machine, in their own browser, on their own account, at their instigation | Still literally covered by the clause ("without our prior written consent"), but needs no evasion, extracts nothing at scale, and the blast radius is one user acting on their own account. This is the only technically viable shape. |
| **C. Ask Tesco** | Write to Tesco for the written consent the clause anticipates | Slow, likely to be declined, but it's the only route that makes A legitimate. Worth one email before investing in B. |

My recommendation is to **treat C as a prerequisite for any hosted version, and scope
any MVP to B** — and to go into B knowing it's a personal-use tool that can't become a
public product feature without Tesco's sign-off. Everything below assumes B.

I've written up the technical findings in full regardless, because they're what you
need to make that call with your eyes open. But I'd flag that the "is this a product?"
question is now the top of the risk list, above every obstacle you listed.

---

## 1. How tesco.com is actually built

Useful news: the site is **server-rendered on full page navigations**, so the data you
need is in the HTML. There's no SPA state to reverse-engineer for reads.

### URL structure (stable, deep-linkable)

The site self-describes its routes in a `<script type="asparagus-data">` blob (Tesco's
micro-frontend router config), including which routes require auth. 72 routes; the
relevant ones:

| URL | Auth | Notes |
|---|---|---|
| `/shop/en-GB/search?query=<q>` | open | Full SSR results |
| `/shop/en-GB/products/<tpnc>` | open | Product detail page |
| `/shop/en-GB/trolley` | **AUTH** | The basket |
| `/shop/en-GB/slots/delivery/<date?>` | **AUTH** | Slot picker, date is deep-linkable |
| `/shop/en-GB/slots/collection/<date?>` | **AUTH** | |
| `/shop/en-GB/favourites` | **AUTH** | Previously bought — see §5 |
| `/shop/en-GB/orders` | **AUTH** | Order history |
| `/account/auth/en-GB/login?from=<encoded-url>` | — | **Login preserves a `from=` redirect target** |

Note `/groceries/...` URLs still route but now redirect to `/shop/...`. Use `/shop/`.

That `from=` parameter is the single most useful thing for handoff: you can hand the
user a link that lands them on their trolley or a specific slot date *after* login.

### Product identity is clean

Every product detail page carries schema.org JSON-LD:

```json
{ "@type": "Product",
  "name": "Tesco British Chicken Breast Fillets 650G",
  "sku": "294007923",           // TPNC — the id used in /products/<id> URLs
  "gtin13": "05057008546325",
  "brand": { "name": "TESCO" },
  "offers": { "price": 4.9, "priceCurrency": "GBP",
              "availability": "http://schema.org/InStock" } }
```

Search pages carry an `ItemList` of product URLs (ordered), so ranking is recoverable
without DOM parsing.

### Extraction from search results is robust

Don't parse CSS classes. The accessible names are stable and semantic:

- `a[href*="/products/"]` → product id + title
- `button[aria-label^="add "]` → the add control; its aria-label is
  `add 1 Tesco Chicken Breast Fillets 320g` — i.e. **quantity and exact product title
  in the accessible name**. This is a gift for both automation and verification.
- Price (`£4.90`) and unit price (`£7.54/kg`) are in the tile text.

A working extraction over `search?query=self+raising+flour` returned, per tile:
`{id, title, price, unit, buttons}` with no fragile selectors.

---

## 2. Obstacle 6 (permissions/browser) — answer first, because it constrains everything

**You cannot do this from a Netlify Function.** Evidence:

```
$ curl -s -o /dev/null -w "%{http_code}" https://www.tesco.com/robots.txt
403
$ curl ... -A "Mozilla/5.0 ... Chrome/150.0.0.0 ..." https://www.tesco.com/shop/en-GB/search?query=milk
403
```

The 403 comes from Akamai (`errors.edgesuite.net` reference). Spoofing the User-Agent
changes nothing, which means the check is on TLS/HTTP fingerprint, not headers.

Cookies observed on a normal browser session confirm the stack:
`_abck`, `bm_sz`, `bm_mi`, `bm_so`, `bm_sv`, `bm_lso` — Akamai Bot Manager. The site
continuously POSTs sensor telemetry to obfuscated, rotating paths
(`/nfohUyNUP/ruQ5R2/wsTy/...`), which is the standard Bot Manager beacon.

Inside a real Chrome session, same-origin `fetch()` **does** work — I pulled eight
search result pages programmatically from the page context. So the boundary isn't
"scripted vs. human", it's "inside a genuine browser session vs. outside one".

### Consequences for architecture

- Reads (search, product lookup) can't be done from the Go Lambda or a Next.js API
  route. They must happen in a real browser.
- That browser should be **the user's**, on their machine — which also solves auth,
  payment, and the basket-handoff problem for free (§3, §4).
- Shape: a local Playwright script or a browser extension, driven by the user, talking
  to Big Shop's existing API for the list. Not a hosted service.
- I'd steer away from "remote browser + we send them a link to it" (Browserbase /
  Steel / browserless style). It's the worst of both worlds: it's posture A legally, it
  needs the user to type their Tesco password into a browser they don't control, and it
  puts a fresh datacentre IP in front of Akamai and RBA every single run.

---

## 3. Obstacle 1 (authentication) — harder than "ask the user to log in"

The login page is at `/account/auth/en-GB/login`, **email-first** (enter email → Next →
second step). I did not attempt to sign in, so the second step is unverified from here.

Two cookies on the login page tell the real story:

- `auth_segment_allow_rba_elevation` — **risk-based authentication**. New device, new
  IP, or unusual behaviour triggers step-up verification (typically an emailed OTP).
- `auth_segment_new_reset_password_journey`, `auth_segment_pwcheck` — active
  experimentation on the auth journey, so the flow is a moving target.

**Implication:** a fresh browser profile looks like a new device *every run* and will
likely eat an OTP challenge every run. That makes "spin up a clean browser and log in"
unworkable as a routine flow. You want a **persistent browser profile** the user logs
into once, so the session and device trust survive between shops. With local Playwright
that's `launchPersistentContext(userDataDir)`.

**Do not** store the user's Tesco credentials in Big Shop. There's no need to: the user
logs in themselves, in their own browser, once.

### A hard finding: there is no anonymous basket

I clicked "Add" on a product while signed out. It does not add — it **redirects to
`/account/auth/en-GB/login?from=<the search page>`**. The header shows a basket widget
with "£0.00 Guide price" and "Grocery basket empty", but it's decorative until you're
authenticated.

This kills any design of the form "build the basket anonymously, then hand the user a
link to adopt it". Every single add requires an authenticated session.

The flip side is genuinely good news for §4: because there's no anonymous basket, **the
basket is server-side and account-scoped**. Items added by an automated session on the
user's account will be visible when the user opens tesco.com on their phone. The
handoff works.

---

## 4. Obstacles 2 & 3 (slots and payment) — your MVP instincts are right

Both are correct calls, and the URL structure supports them cleanly.

**Slots.** `/shop/en-GB/slots/delivery/<date>` is deep-linkable and auth-gated. So:
send the user to `/account/auth/en-GB/login?from=%2Fshop%2Fen-GB%2Fslots%2Fdelivery`,
let them pick, then resume. You need to store enough state to resume — see §7.

One thing to verify before building: **whether Tesco requires a slot to be booked
before items can be added, or only before checkout.** I couldn't test this signed out.
Historically Tesco lets you fill a trolley first and prompts for a slot at checkout, but
it also shows "Reserve a slot for either home delivery or collection" prominently in the
basket sidebar. If a slot *is* required first, the state machine gets an extra
mandatory pause at the front, which changes the UX materially. Worth checking with a
real account before designing around it.

Also worth knowing: slot availability is itself a scarce resource — popular slots go
days ahead. A flow that says "we'll build your basket now, you book a slot later" can
leave the user with a basket and no slot for four days.

**Payment.** Handing over at the basket is right, and the mechanism is
`https://www.tesco.com/shop/en-GB/trolley`. Never automate checkout. Do not store card
details. This also keeps the user as the one who actually places the order, which
matters for both the T&C exposure and for trust.

---

## 5. Obstacle 4 (inexact ingredients) — the real engineering problem

This is where the actual product quality lives, and it's worse than it looks. I ran a
set of realistic queries against live search. Results, top 5 each:

| Query | Top results (rank 1 →) |
|---|---|
| `olive oil` | **Olly's Garlic & Basil Olives**, Olly's Piri Piri Olives, Olly's Chimichurri Olives, *Tesco Olive Oil 1L* (rank 4) |
| `garlic` | **Heinz Tomato & Garlic Marinara Sauce**, Freeze-Dried Chopped Garlic, Garlic & Coriander Naan, *Tesco Large Garlic* (rank 4) |
| `free range eggs` | **Two Chicks Liquid Egg Whites**, *Tesco Medium Free Range Eggs 12 Pack* (rank 2) |
| `self raising flour` | Stockwell & Co. SR Flour 1.5Kg, … then **Shredded Wheat Bitesize *Raisin*** and **Cinnamon & *Raisin* Loaf** at ranks 9–10 |
| `chicken breast` | Good top-5, but the 51 results include **cat food** ("Untamed Chicken Breast in Gravy Cat Food") and turkey mince |
| `2 cloves of garlic, crushed` | **TESCO Finest One Clove Garlic**, Surya Crushed Garlic, Tesco Large Garlic |
| `400g tin chopped tomatoes` | **Tesco Italian Finely Chopped Tomatoes 400G**, Napolina Chopped Tomatoes 400G, … |
| `fresh parsley, chopped` | **Tesco Fresh Cut Flat Leaf Parsley 30G**, Curled Leaf Parsley 30g, … |

### Four findings that should shape the design

**1. Rank 1 is unreliable — never auto-accept it.** "olive oil" → olives and "garlic" →
marinara sauce are not edge cases; they're the two most common cooking ingredients in
the list. The top slots appear to carry sponsored/promoted placements.

**2. Counter-intuitively, the *raw* recipe string often beats the cleaned noun.**
`2 cloves of garlic, crushed` returns actual garlic at rank 1, while bare `garlic`
returns marinara sauce. Tesco's search is doing something reasonable with the extra
tokens. So: **don't strip the ingredient down before searching.** Try the fuller string.

**3. Including pack size in the query is the single biggest quality win.**
`400g tin chopped tomatoes` returned 13 total results, essentially all correct.
`1 tbsp soy sauce` returned 785 results but a clean top 4. Compare bare `garlic`'s 72
results with junk at the top. Big Shop already has exactly this data — the combined
`Amount` carries `{quantity, unit, baseQuantity, baseUnit}` — so we can synthesise
`"400g chopped tomatoes"` rather than searching `"chopped tomatoes"`.

**4. HTTP status is not a validity signal.** Queries containing punctuation or leading
quantities (`2 cloves of garlic, crushed`, `fresh parsley, chopped`, `1 tbsp soy sauce`)
returned **HTTP 404 with a complete, correct results page in the body**. Any
implementation that checks `res.ok` before parsing will silently drop the best queries.
This is exactly the class of bug `CLAUDE.md` already warns about with `use-http` — parse
the body, don't trust the shared success flag.

### Proposed matching approach

A three-stage pipeline, reusing what's already here:

1. **Query synthesis** — build the search string from the combined `Amount`
   (`baseQuantity` + `baseUnit` + ingredient name), not the bare ingredient name.
2. **Candidate retrieval** — take the top ~20 tiles with title, price, unit price, id.
3. **LLM re-rank** — one call scoring candidates against the ingredient *and* the
   required quantity. This is the same shape as `lib/recipe-import/extract.js`
   (structured outputs, `lib/openai-client.js`), so it fits the existing pattern. It
   returns a chosen product **plus a confidence**, and below a threshold the item goes
   to a review queue instead of the basket.

**Quantity → pack count is a second, separate problem.** The user needs 400g of chicken;
Tesco sells 320g, 650g, 1kg packs. Two sub-problems:
- *Rounding policy.* Round up, presumably — but 400g needed vs. a 1kg pack is a lot of
  waste, and `formatDisplayQuantity` in `internal/pkg/service/list.go:391` already
  encodes a "round up to a whole" rule for relative units. Reuse the thinking.
- *Extracting pack size from the product title.* Titles embed it inconsistently:
  `650G`, `1KG`, `2.272L, 4 Pints`, `12 Pack`, `4 X 400G`, `270G-470G` (variable
  weight). The `£/kg` unit price is a more reliable derivation: `price ÷ unitPrice` =
  pack weight. Prefer that, fall back to title parsing.

**Where this data should live.** The really valuable asset here is a **learned mapping
from Big Shop ingredient → Tesco TPNC**, cached per account. Once a user has confirmed
"my olive oil is `Tesco Olive Oil 1L` / id 254656652", we never search for it again.
That turns a flaky LLM-search problem into a lookup after two or three shops, and it's
personalised (their brand, their pack size). This is the piece I'd build first — the
search fallback is only for the cold path.

The `favourites` route (`/shop/en-GB/favourites`, auth-gated) and order history are the
obvious bootstrap: seed the mapping from what the user already buys, before ever
searching.

---

## 6. Obstacle 5 (out of stock / missing) — thinking beyond "leave it on the list"

I couldn't exercise the out-of-stock path signed out. What's known:

- The JSON-LD `offers.availability` field is `http://schema.org/InStock`, so there's a
  machine-readable availability signal on the PDP.
- Tesco's own substitution mechanism happens at *picking* time, not basket time — the
  user opts in/out per order and approves substitutes at the door. So "out of stock now"
  and "unavailable at delivery" are different failures, and the second one can't be
  solved at basket-build time at all.

Better than leaving it silently on the list:

- **Split the outcome into three buckets, and show them.** Added / needs-review /
  not-found. The user's whole reason for using this is to not think about it, so
  silently leaving items behind is the failure mode that erodes trust fastest.
- **Ask the LLM for a substitute in the same re-rank call** — if `fresh dill` is
  unavailable, `dried dill` is usually fine and the model knows that. Present it as a
  suggestion, don't auto-add.
- **Never silently downgrade.** Substituting Finest for value brand, or 1kg for 400g,
  without saying so, is the thing that makes people stop trusting an auto-ordering tool.

---

## 7. What this needs from the Big Shop side

Good news: the read side is already the right shape.

- `GET /shopping-list` returns `ShoppingList{Recipes, Ingredients, Extras}` where each
  `ListIngredient` has `Amounts[]` of `{quantity, unit, baseQuantity, baseUnit}`,
  plus `department` and `isBought`. `baseQuantity`/`baseUnit` are exactly what §5 needs
  for query synthesis. (`netlify-functions/recipes/internal/pkg/common/types.go`)
- The combining work is done and lives in Go
  (`internal/pkg/service/list.go`, `CombineIngredients` / `ApplyDisplayUnits`).

What's missing:

1. **Items have no id.** `ListIngredient` is keyed by name in a map, and one *item* can
   be several `list` rows (per `docs/adr/0005`). Any Tesco mapping table needs a stable
   key — name-per-account works, but it's worth deciding deliberately rather than
   inheriting it.
2. **A new persistence concern**: `ingredient → tesco_tpnc` mapping, and an "order
   attempt" record to survive the login/slot pauses. Both are new tables + Go routes.
   Migrations are applied **manually, in order** here — no runner in the deploy.
3. **Nothing long-running can live in the existing deployment.** `netlify.toml` has no
   `[functions]` block, so the default 10s synchronous timeout applies everywhere; the
   Go Lambda's `dev` mode even sets 3s read/write timeouts. The one existing async job
   (`pages/api/recipe-image.ts` + Netlify Blobs + a 2s `refetchInterval` poll in
   `pages/recipes/new.tsx`) is a fire-and-forget promise that *isn't guaranteed to
   complete* on Lambda, since the container can be frozen after the response. Don't
   extend that pattern to something that takes minutes and spends the user's money.

   Since §2 already forces the browser onto the user's machine, this resolves itself:
   the long-running part runs locally, and Big Shop only stores results.

### Sketch of the flow

```
Big Shop list ──GET /shopping-list──> local runner (Playwright, persistent profile)
                                          │
              ┌───────────────────────────┤
              │  for each item:           │
              │   cached TPNC? ──yes──> add to basket
              │        │no               │
              │   search (full string +   │
              │    pack size) → top 20 →  │
              │    LLM re-rank →          │
              │      confident? ──> add + cache mapping
              │      unsure?    ──> review queue
              └───────────────────────────┤
                                          ▼
                          report: added / review / not-found
                                          ▼
                     hand off: tesco.com/shop/en-GB/trolley
                     (user books slot, checks, pays)
```

Pauses (login, slot booking) are handled by the runner being interactive and local —
which is much simpler than the resumable server-side state machine you'd need for a
hosted version.

---

## 8. Open questions worth answering before building

1. **The T&C question (§0).** Personal tool, or product? If product, this doesn't ship
   without Tesco's written consent, and that changes whether any of the below matters.
2. **Does Tesco require a slot before adding items, or only at checkout?** Needs a real
   account to test. Changes the state machine.
3. **What does the "Add" control look like once an item is in the basket?** It becomes a
   quantity stepper; setting quantity 3 is presumably click-add-three-times or type into
   the stepper. Unverified — needs a logged-in session.
4. **Does the basket survive between sessions on the same account?** Almost certainly
   yes given there's no anonymous basket, but it's load-bearing for the handoff.
5. **Clubcard prices** are shown as separate offers with validity windows tied to
   *delivery date* ("Offer valid for delivery from 24/06/2026 until 25/08/2026"). If we
   ever surface price, we'd be quoting a number that depends on a slot not yet booked.
6. **Scope of the first version.** Given §5, I'd argue the highest-value thing isn't
   auto-ordering at all — it's the **ingredient → product mapping**, built once
   interactively. Auto-ordering on top of a confirmed mapping is comparatively easy;
   auto-ordering on top of live search is a coin flip per item.

---

---

# Part 2 — The rest of the field

## 9. Landscape summary

Every retailer was tested the same way: plain `curl` against a real search URL, then a
real browser, then an anonymous add-to-basket, then a read of the terms.

| Retailer | Plain `curl` | Bot defence | Anonymous basket | Structured data | T&C automation clause |
|---|---|---|---|---|---|
| **Ocado** | ✅ 200, 1.7MB SSR | AWS/CloudFront, not blocking reads | ✅ **works** | ⭐ Redux store, full entities | **None found** (62k chars) |
| **Morrisons** | ✅ 200, 1.4MB SSR | same as Ocado | untested | ⭐ identical to Ocado | not found |
| **Iceland** | ✅ 200, 2MB SSR | none seen | untested | unexamined | not found |
| **Tesco** | ❌ 403 everything | Akamai Bot Manager | ❌ → login | JSON-LD only | ⛔ **explicit ban** |
| **Sainsbury's** | ❌ 403 | Akamai Bot Manager | ❌ → login | unexamined | unexamined |
| **Waitrose** | ❌ connection fails | Akamai | ❌ didn't add | `__PRELOADED_STATE__` | unexamined |
| **Asda** | ❌ 403 | Cloudflare | untested | unexamined | ⛔ robots bans **ClaudeBot** by name |

**There is no official ordering API anywhere in UK grocery.** Confirmed across sources:
no OAuth, no REST, no webhooks, from any of Tesco, Sainsbury's, Asda, Morrisons or
Ocado. Every working integration in existence is reverse-engineered.

The field splits cleanly into two groups, and the split is not subtle.

### The Akamai group — Tesco, Sainsbury's, Waitrose (+ Asda on Cloudflare)

Effectively identical postures. Sainsbury's is Tesco with the names changed: same
Akamai Bot Manager cookies (`_abck`, `bm_sz`, `bm_so`, `bm_sv`), same obfuscated
rotating sensor beacon (`POST /1iEi9OjwQ0/dwGFIipPQJ/...`), 403 to `curl`, and adding
to trolley signed-out redirects to `account.sainsburys.co.uk/gol/login`. Waitrose refuses
`curl` at the connection layer entirely and didn't add anonymously either.

**Asda deserves a specific call-out.** Its `robots.txt` carries Cloudflare Content
Signals `search=yes, ai-train=no, use=reference`, and then explicitly disallows, by
name: `ClaudeBot`, `GPTBot`, `CCBot`, `Google-Extended`, `Bytespider`, `Amazonbot`,
`Applebot-Extended`, `meta-externalagent`, `CloudflareBrowserRenderingCrawler`. That is
as clear a "no" to AI agents as a site can give without a lawyer. Asda is off the table.

### The Ocado group — Ocado and Morrisons

Morrisons runs the **Ocado Smart Platform**. Not "similar to" — identical: same
`__INITIAL_STATE__` Redux shape, same `productEntities`, same `/products/<slug>/<id>`
URLs, same `?q=` search param, same `robots.txt` structure down to the shared
`# Internal URLs` comment. **One adapter covers both retailers.**

And it's about to cover a third: **Asda announced in May 2026 that it is adopting
Ocado's front-end webshop**, in-store fulfilment and last-mile software, rolling out
from **2027**. So the OSP stack is on track to be *the* dominant UK online grocery
platform — Ocado + Morrisons + Asda. An OSP adapter is the highest-leverage thing to
build in this space, and it gets more valuable over time rather than less.

---

## 10. Ocado in detail — why it's a different proposition

### It answers your obstacles far better than Tesco

**Obstacle 6 (browser access).** Plain `curl` gets `200` and 1.7MB of server-rendered
HTML from `https://www.ocado.com/search?q=olive+oil`. No Akamai, no fingerprint wall on
reads. This is the constraint that forced everything else on Tesco, and on Ocado it
simply isn't there for search and product data.

**Obstacle 1 (auth).** **The anonymous basket works.** I added a product signed-out and
the trolley went to £4.90 with a working quantity stepper — and it persisted across
navigations. Tesco bounces you to login on the very first add; Ocado does not. Login is
needed for slots and availability ("To see current availability and delivery slots,
please log in or register to shop"), but *basket construction does not require it*.

That reshapes the whole MVP. You can build the basket without ever touching the user's
credentials, then hand off. What you can't do is transfer an anonymous basket to their
account — that still needs them logged in — so the realistic flow is still
"user is logged in, we fill the trolley", but the failure mode is far gentler.

**Obstacle 4 (matching).** Two big wins.

*Search relevance is simply better.* The query that broke Tesco worst — `olive oil`,
which returned three brands of **olives** before any oil — returns nothing but olive oil
on Ocado, top to bottom. `chicken breast` returned six clean, correct results.

*And the product data is properly structured.* Each entity in `__INITIAL_STATE__`:

```json
{
  "productId": "78bbc081-d803-4bb8-a9cc-1a7df31f08c7",
  "retailerProductId": "654207011",
  "name": "Mr Organic Extra Virgin Olive Oil",
  "brand": "Mr Organic",
  "available": true,
  "size": { "value": "750ml" },
  "categoryPath": ["Food Cupboard", "Oils, Fats & Vinegars", "Extra Virgin Olive Oil"],
  "price": {
    "current": { "amount": "11.50", "currency": "GBP" },
    "original": { "amount": "14.50", "currency": "GBP" },
    "unit": { "label": "fop.price.per.litre",
              "current": { "amount": "15.33", "currency": "GBP" } }
  },
  "quantityInBasket": 0,
  "featuredProductCampaign": { "source": "CITRUS_AD", "campaignName": "CitrusAdCampaign" }
}
```

Compare what Tesco forced (§5): deriving pack weight from `price ÷ unitPrice`, parsing
`4 X 400G` and `270G-470G` out of product titles, and no way at all to tell a sponsored
placement from an organic result. Ocado hands you:

- **`size.value`** — explicit pack size. The §5 title-parsing problem disappears.
- **`categoryPath`** — a real taxonomy. You can constrain candidates to
  `Oils, Fats & Vinegars` before ranking, which fixes the "garlic → marinara sauce"
  class of error structurally rather than by asking an LLM to notice.
- **`available`** — machine-readable stock status (obstacle 5).
- **`price.unit.label`** — a typed unit (`per.litre`), not a string to regex.
- **`featuredProductCampaign` / `CITRUS_AD`** — **sponsored results are labelled**, so
  you can drop them. This was invisible on Tesco and was polluting its top slots.
- **`quantityInBasket`** — basket state inline, so verification is free.

This meaningfully shrinks the LLM's job. On Tesco the model had to do relevance,
category sanity-checking, pack-size extraction *and* quantity maths from noisy strings.
On Ocado it only has to pick between pre-filtered, correctly-categorised candidates
whose sizes are already parsed.

### The terms are materially different

Ocado's consumer purchase T&Cs run to ~62,000 characters and contain **zero** matches
for robot, spider, scrape, crawl, automated, bot, data mining or systematic access. The
nearest relevant clause is:

> You are permitted to use the material data and content only for your personal use in
> placing orders through the Website, and you may not otherwise copy, reproduce,
> transmit, publish, display, distribute, commercially exploit, use or create derivative
> works of any material, data and content on the Website without our prior written
> permission.

Read carefully, this **affirmatively permits** the thing you want to do — "personal use
in placing orders through the Website" — while restricting *republishing or commercially
exploiting* the catalogue. It regulates what you do with the data, not how you access it.
That is close to the opposite of Tesco's clause.

**The caveat that follows from it:** a personal tool placing your own orders sits inside
the permitted use. A hosted Big Shop feature that caches Ocado's catalogue across many
users, or builds a product on their data, would run at "commercially exploit / create
derivative works" and needs written permission. **The line here is personal-vs-commercial,
not manual-vs-automated** — which is a much more workable line than Tesco's.

### One honest complication: robots.txt

Ocado's `robots.txt` allows product pages and publishes sitemaps, and — unlike Asda —
does **not** block ClaudeBot or GPTBot. But under the heading
`# Disallow user-specific, transactional, and low-value pages` it disallows exactly the
paths this feature needs:

```
Disallow: /search
Disallow: /basket
Disallow: /lists
Disallow: /favorites
Disallow: /orders
Disallow: /delivery/home/slots
Disallow: /api/
```

I'd report this straight rather than spin it. Two things are true at once: these are the
paths we'd use, and `robots.txt` is addressed to *crawlers* building indexes, with a
stated rationale here of "low-value transactional pages" — i.e. crawl-budget management,
not an anti-automation stance. Whether it binds a user-directed agent doing that user's
own shopping is genuinely unsettled, and Ocado's own terms explicitly permit personal-use
ordering. **That's my reading, not a legal opinion, and it's the weakest link in the
Ocado case** — worth a lawyer's eye before anything ships publicly.

Practical consequence: prefer `/products/<slug>/<id>` (allowed) over `/search`
(disallowed) wherever the mapping is already known — which is exactly what the cached
ingredient→product mapping from §5 gives you. Search is the cold path only.

---

## 11. Prior art

[`abracadabra50/uk-grocery-cli`](https://github.com/abracadabra50/uk-grocery-cli) (MIT,
~70 stars, active) is doing precisely this: multi-supermarket grocery automation for UK,
explicitly "built for AI agents", with an MCP server. Its independently-reached
conclusions match mine almost exactly:

- "UK supermarkets offer zero APIs… none of them provide developer APIs."
- Sainsbury's via reverse-engineered REST; Ocado via internal JSON API + SSR scraping;
  Tesco via browser automation, with a warning that "Tesco uses Akamai bot detection,
  which can block automated form filling."
- Legal section restricts use to personal shopping, "not intended for commercial
  scraping or data collection."

One discrepancy worth noting: it describes Ocado as sitting behind AWS WAF bot
detection, and reports slot booking and checkout as incomplete for that reason. My own
testing found no blocking on **reads** — plain `curl` returned 200 throughout. Both can
be true: the WAF may gate writes, or trigger on volume rather than on a single request.
Treat "Ocado reads are open" as verified and "Ocado writes are open" as unverified.

### 11.1 Why we should not simply adopt it

Read at source (~5,800 LOC, MIT, `src/providers/`), four things disqualify it as a
drop-in — though one part is well worth stealing.

**1. It does not solve our actual problem.** There is **no ingredient→product matching
logic anywhere in the codebase** — no ranking, no fuzzy matching, no pack-size or
quantity reasoning, no confidence scoring. `docs/SMART-SHOPPING.md`, which sounds like
it might be that, is a static markdown list of the "Dirty Dozen" for an LLM to read.
The tool is pure transport: search, basket, slots, checkout. Everything in §5 — the part
that's actually hard, and the part that determines whether the feature is any good —
would still be ours to build.

**2. Its `Product` type discards exactly what makes Ocado worth targeting.**
`mapEntity()` in `src/providers/ocado.ts` flattens the rich entity down to
`{name, price, unit_price, in_stock, size, rating}` and **drops `categoryPath` and
`featuredProductCampaign`**. Those are two of the three reasons §10 recommends Ocado:
the taxonomy that structurally fixes "garlic → marinara sauce", and the flag that lets
us drop CitrusAd sponsored placements. As written, sponsored results come back as
ordinary ranked products. It also sets `unit_price.measure` from `size.value` ("750ml")
rather than the actual unit label (`per.litre`), conflating pack size with price basis.

**3. Its Tesco support works by defeating bot detection.** `src/providers/tesco/auth.ts`
uses `playwright-extra` with `puppeteer-extra-plugin-stealth`, plus
`--disable-blink-features=AutomationControlled`. That is anti-detection tooling, and its
whole purpose is to make automation not look like automation. Using someone else's
evasion code does not change our position with respect to Tesco's explicit T&C ban (§0)
— it just moves the evasion into a dependency. **§0's recommendation stands unchanged.**
It also implements real checkout (`src/browser/tesco-checkout.ts`), placing live orders
off regex-scraped page text like `/(?:order total|total)[:\s]*£(\d+\.?\d*)/i`.

**4. Credential handling is incompatible with Big Shop.** It accepts passwords via a
`--password` CLI flag (shell history, process listings), via `GROC_PASSWORD` /
`SAINSBURYS_PASSWORD` env vars, and — most significantly — its MCP `grocery_login` tool
takes `email` and `password` as **tool arguments**, so credentials pass through the
agent's context window. Fine for a personal CLI you run yourself; not something to embed
in a hosted product.

**Maturity, for the record:** 51 commits, 32 of them in one burst in Feb 2026, then a
trickle; effectively one contributor (33 of 51 commits); not published to npm (the
`groc` package on npm is an unrelated documentation tool), so it installs from git.
That's a thin single-maintainer dependency for code that spends the user's money.

### 11.2 What to take from it

The **Ocado provider is genuinely good and worth using as a reference** — it
independently arrived at the same approach §10 describes: fetch the SSR listing page,
extract `productEntities`, use DOM anchor order as the site's own ranking, and fail
loudly when `productEntities` is absent because that means a WAF challenge or an expired
session rather than zero results. That last detail is a nice touch we should copy.

MIT licence means we can vendor and adapt it. The sensible use is: **take the Ocado
fetch-and-parse approach, keep the fields it drops, write our own matching layer, and
ignore the Tesco and checkout code entirely.**

---

## 12. Revised recommendation

**Target Ocado, not Tesco.** On every axis that matters it's better: no bot wall on
reads, an anonymous basket, structured product data with pack size and stock status,
labelled sponsored results, better search relevance, and terms that permit personal-use
ordering instead of banning automated access. One adapter also covers Morrisons today
and, from 2027, Asda.

Revised from §0's conclusion: the Tesco write-up recommended scoping to a local tool
because the T&C clause and Akamai left no other option. **For Ocado the constraint is
different in kind** — the line is personal vs. commercial use rather than manual vs.
automated. A personal tool is comfortably inside their terms; a hosted multi-user
product would need Ocado's written permission, and is worth actually asking for, since
the ask is far more reasonable than the equivalent Tesco ask.

Unchanged from Part 1: build the **cached ingredient→product mapping** first (§5). It
matters even more here, because it keeps you on allowed `/products/` paths and off
`/search`.

Sequenced:

1. **Ocado adapter, read-only.** Search → parse `__INITIAL_STATE__` → filter
   `featuredProductCampaign` → constrain by `categoryPath` → rank. Verifiable against
   the real site with no account and no writes.
2. **Mapping table + review UI.** Confirm matches once, per ingredient, per account.
3. **Basket writes**, in a real browser with the user's session. Verify the anonymous
   basket finding still holds for a logged-in account, and check whether the WAF gates
   writes (§11).
4. **Hand off** at the trolley for slot and payment, exactly as Part 1 concluded.

Do not build the Tesco adapter. Do not build Asda.

### Still open

- Does Ocado's WAF gate *writes*? (§11 discrepancy — the single most important unknown.)
- Morrisons anonymous basket and T&Cs — untested; likely mirrors Ocado given shared platform.
- Iceland — `curl`-accessible with 2MB SSR, but `robots.txt` disallows `/search`,
  `/basket`, `/checkout`. Small range; probably not worth an adapter.
- Ocado's £40 minimum spend and slot scarcity — product constraints, not technical ones.

---

## Sources

**Part 1 — Tesco**
- [Tesco General Terms & Conditions](https://www.tesco.com/shop/zone/general-terms-and-conditions) — the automated-access clause
- [Online grocery shopping gets the Tesco API treatment | IT Pro](https://www.itpro.com/607668/online-grocery-shopping-gets-the-tesco-api-treatment)
- [Tesco Labs Developer Portal](https://devportal.tescolabs.com/) — unmaintained, no ordering API

**Part 2 — the field**
- [Ocado T&Cs: Purchase (Consumer and Business Customers)](https://www.ocado.com/content/terms-conditions-purchase-consumer) — the personal-use clause
- [Asda partners with Ocado Group to enhance online grocery service](https://corporate.asda.com/newsroom/2026/29/05/asda-partners-with-ocado-group-to-enhance-online-grocery-service) — front-end webshop, from 2027
- [UK grocer Asda taps Ocado to revamp online business | Yahoo Finance](https://finance.yahoo.com/sectors/technology/articles/asda-taps-ocado-automation-uk-062358067.html)
- [abracadabra50/uk-grocery-cli](https://github.com/abracadabra50/uk-grocery-cli) — MIT, prior art
- [Supermarket Sweep: How APIs Are Shaking up Grocery | Nordic APIs](https://nordicapis.com/supermarket-sweep-how-apis-are-shaking-up-grocery-store-business-models/)
- `robots.txt` for ocado.com, groceries.morrisons.com, groceries.asda.com, iceland.co.uk

**Direct observation**
- Live exploration of tesco.com (2026-07-28) and ocado.com, groceries.morrisons.com,
  sainsburys.co.uk, waitrose.com, groceries.asda.com, iceland.co.uk (2026-07-29), all
  unauthenticated. No account was logged into and no order was placed.
