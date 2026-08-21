# Runbook: testing the onboarding email before switching it on

The operator half of [`specs/completed/email.md`](../specs/completed/email.md). Everything
here needs a live SendGrid key and a real mailbox, so none of it could run in the PR that
carried the code.

Decisions and rationale: [ADR-0010](./adr/0010-lifecycle-email-lawful-basis.md).

**Nothing here sends anything to anyone but you until step 5.** The programme ships behind
`ONBOARDING_EMAIL_ENABLED`, which is `false` in `fly.toml`, so the ticker runs and sends
nothing and no new signup gets a welcome. Steps 1–4 use `send-test`, which deliberately
bypasses that flag and mails only the address you name.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| An address you own, and a second one you are willing to burn | Steps 2 and 4 |
| SendGrid dashboard access | Step 4's undo, and step 6 |
| `fly ssh console` access to `big-shop-api` | Steps 2 and 4 against production |
| Docker, for the local stack | Step 1, and step 3 |

**Why a burnable address.** SendGrid suppression is permanent and keyed on the *address*,
not the user. The moment you click your own unsubscribe link, every later send to that
address is accepted by the API, logged as a success, and delivered nowhere. It looks
exactly like a broken template. Use a `+suffix` alias for step 4 and keep your real address
clean for everything else.

### Check the configuration actually arrived

Under `machine_config.json` a container receives only the secrets it *declares*, so
`fly secrets set` alone is not enough — `fly.toml:36-46` documents this trap at length.

```bash
fly secrets list -a big-shop-api          # SENDGRID_API_KEY present?
fly ssh console -a big-shop-api -C "printenv SENDGRID_API_KEY" | head -c 8
fly ssh console -a big-shop-api -C "printenv SENDGRID_ASM_GROUP_ID"   # 32124
fly ssh console -a big-shop-api -C "printenv ONBOARDING_EMAIL_ENABLED" # false, for now
```

If the second command prints nothing while the first lists the secret, the key is set but
not declared. Add it to the `api` container's `secrets` array in `machine_config.json` and
redeploy.

### What the logs should say at boot

```
lifecycle: onboarding email disabled (set ONBOARDING_EMAIL_ENABLED=true to enable); the ticker will send nothing
```

A switched-off programme and a broken one both send nothing, so this line is the only thing
that tells them apart. If you see `onboarding email enabled` before you have finished this
runbook, stop and check the flag.

---

## 1. Read the copy — `preview`

The fast loop. Renders every template in a browser, sends nothing, needs no key.

```bash
cd netlify-functions/recipes
SITE_URL=http://localhost:3000 go run . preview        # serves 127.0.0.1:8090
```

Then open <http://localhost:8090> and click through `welcome`, `tips`, `recipes`,
`feedback` and `invite`.

**A browser reload does not pick up a template edit.** The templates are `go:embed`-ed and
parsed once at startup, so seeing a change means restarting the command. This is worth
knowing because "edit, reload, nothing changed" reads as a broken template.

What to check here — everything that does not depend on a mail client:

- The words. This is the only review the copy gets before it reaches strangers.
- The four onboarding emails each end with **"Unsubscribe from these emails"**. The invite
  does **not**, and must not: transactional mail is deliberately not unsubscribable.
- Links point where you expect. In preview they carry `utm_source=email`,
  `utm_medium=lifecycle` and `utm_campaign=<kind>`, and **nothing else** — no user id, no
  account id, no token. A test enforces this, but look anyway.

---

## 2. Put them in a real inbox — `send-test`

This is the step no local tool can replace: inbox placement, how the layout degrades in
real clients, and whether SPF/DKIM align.

Locally, against the real SendGrid:

```bash
cd netlify-functions/recipes
SENDGRID_API_KEY=<key> SENDGRID_ASM_GROUP_ID=32124 SITE_URL=https://www.bigshop.life \
  go run . send-test --to=you@example.com --kind=welcome
```

Or from production, which is the better test because it uses exactly the configuration
that will really send:

```bash
fly ssh console -a big-shop-api -C "recipes send-test --to=you@example.com --kind=welcome"
```

Repeat for `tips`, `recipes`, `feedback` and `invite`. Expect `sent <kind> to <address>`.

If it prints `nothing sent: SENDGRID_API_KEY, or SENDGRID_ASM_GROUP_ID for onboarding
email, is not set`, that is the clean-skip path — the configuration has not reached the
process. Go back to step 0.

**`send-test` never writes an `email_send` row.** A test send is not a send to that user,
so it cannot consume a real recipient's place in the sequence.

### What to look at in each message

| Check | Why it matters |
| --- | --- |
| Inbox, not Promotions or Spam | The whole programme is worthless from the spam folder |
| Sender reads `Big Shop <hello@bigshop.life>` | One verified identity, settled once |
| **Reply goes to `hello@bigshop.life`** | Day 14 asks for a reply; there is no `Reply-To` override |
| Renders in Gmail, Outlook and Apple Mail | Hand-written table markup is the accepted cost of keeping copy in version control |
| Renders on a phone | Most people will read it there |
| The unsubscribe footer is present and the link resolves | **Do not click it yet — see step 4** |
| Gmail shows its own unsubscribe control | Confirms the `List-Unsubscribe` headers arrived |
| Links are `www.bigshop.life`, not a SendGrid redirect | Click tracking is refused per message; a rewritten link means it came back on |

That last row is worth checking properly. Open a link and look at the address bar: if it
goes through a SendGrid domain, link rewriting is enabled somewhere and it both contradicts
[ADR-0010](./adr/0010-lifecycle-email-lawful-basis.md) and breaks the `utm` attribution.

---

## 3. Check the schedule — a backdated user

Steps 1 and 2 say nothing about *when* mail goes out. Test that against the local stack,
where inventing a user is free.

```bash
npm run dev:full     # or bring up db + api yourself
```

Insert a user dated eight days ago, in a zone you can reason about:

```sql
INSERT INTO user (id, name, email, timezone, created_at)
VALUES ('test|schedule', 'Schedule Test', 'you@example.com', 'Europe/London',
        NOW() - INTERVAL 8 DAY);
```

The ticker fires hourly and sends at **10:00 in the recipient's own timezone**, so what you
are looking for is:

- Nothing at all outside their 10:00 hour.
- Exactly **one** email on the first tick inside it — the tips email, not tips *and*
  recipes, even though both are overdue. One email per user per day is the guard that
  matters most; without it a week's outage sends three within a second, which is the
  likeliest way this design earns a spam report.
- Nothing more that day, including after a restart. `Start` ticks on boot as well as
  hourly, so restarting the API inside the send hour is a good way to prove the guard.
- The next day's tick sends the next one.

The Go tests cover this ground against an injected clock (`internal/pkg/lifecycle`), so
this is the belt-and-braces check that the SQL really selects what the tests assume.

Tidy up afterwards: `DELETE FROM user WHERE id = 'test|schedule';`

---

## 4. Test the unsubscribe — last, and with the burnable address

Leave this until you are otherwise finished, because it is the one step that permanently
changes state.

```bash
fly ssh console -a big-shop-api -C "recipes send-test --to=you+unsub@example.com --kind=tips"
```

Then click **Unsubscribe from these emails** and confirm:

1. SendGrid's confirmation page loads and says you are unsubscribed.
2. A second `send-test` to that same address still reports `sent` — the API accepts it —
   but nothing arrives. That is the suppression working, and it is exactly why this looks
   like a broken template if you forget you did it.
3. The address appears under **Suppressions → Unsubscribed** for group 32124 in the
   SendGrid dashboard.

Point 2 is the whole reason for using a burnable address.

**To undo:** remove the entry under Suppressions → Unsubscribed. This is the one place the
permanence argued for in the spec is inconvenient rather than correct — the suppression is
deliberately kept even through Account deletion, so that an unsubscribe outlives the
Account.

---

## 4b. Curate the Day 8 recipes — **required before switching on**

The Day 8 email links each dish at `/recipes/add/<slug>`, and each slug has to
name a **Featured Recipe** that exists and is flagged in production. Nothing in
CI can check this: the slugs are hand-picked in
`internal/pkg/service/email/templates/recipes.html`, in the repo, and the flag
lives in the database. See [ADR-0011](./adr/0011-featured-recipes-are-our-own-content.md).

A dead link is not a crash — the landing page says the recipe is not available
and that nothing changed in your collection, which is what that page is for —
but it is still a bad send.

The three slugs the template currently uses:

- `pasta-e-ceci`
- `roast-chicken-thighs-with-lemon-and-potatoes`
- `dal-with-fried-onions`

For each one, signed in to production as an admin:

1. **Create the Recipe** with the name that produces that slug (`Slugify` on the
   name — "Pasta e ceci" → `pasta-e-ceci`). Importing from a URL to get the
   structure and the ingredient lines is fine and expected.
2. **Write the method yourself.** This is the rule ADR-0011 exists to record and
   the one most likely to be skipped under time pressure: flagging a Recipe is
   *distribution*, not personal use, so the prose has to be ours. Ingredient
   lists are statements of fact; a method is somebody's writing.
3. **Check the ingredients are ones the catalog knows**, with Base Units and
   Unit Sizes. This is not a code check and does not need to be, because the
   Global Catalog is shared: tick the Recipe onto **your own** Shopping List and
   look at it. What you see is what a brand-new user sees. If an ingredient
   shows as two uncombined Amounts, fix the catalog before flagging — that list
   is the first one they will ever generate, and it is where every claim the
   marketing page makes has to be visible.
4. **Tick Featured** on the recipe form and save.
5. **Follow the link yourself**, logged in as somebody else if you can, and
   confirm it lands on a copy.

**Un-flagging a Recipe the live template links to breaks that link.** If you
retire one, edit the template in the same change.

## 5. Switch it on

Only after steps 1–4. Two things to do, in this order.

### First: consider the gap

Anyone who signed up between the deploy and this moment is already past day 0, 3 or 8, so
enabling walks each of them through the backlog one email a day — starting with a "Welcome
to Big Shop" that is however many days late. That is the same wound the launch cutoff exists
to prevent, in miniature.

If the gap is a day or two, ignore it. If it has grown to weeks, move the cutoff forward
first so those users are excluded exactly as the original user base was:

```sql
UPDATE email_launch SET launched_at = NOW() WHERE id = 1;
```

Check what you are about to mail before deciding:

```sql
SELECT COUNT(*) FROM user u
  JOIN email_launch l ON l.id = 1
 WHERE u.created_at >= l.launched_at
   AND u.email IS NOT NULL AND u.email <> '';
```

### Then: flip the flag

Set `ONBOARDING_EMAIL_ENABLED = "true"` in `netlify-functions/recipes/fly.toml` and deploy:

```bash
fly deploy ./netlify-functions/recipes --build-arg SERVICE_VERSION=$(git rev-parse --short HEAD)
```

It is in `[env]` rather than `fly secrets` on purpose — it is not a credential, and `[env]`
values reach the container without the declare-it-twice trap. That also means the change is
a reviewable one-line diff rather than an invisible dashboard action.

Confirm from the logs:

```
lifecycle: onboarding email enabled, ticking every 1h0m0s
```

---

## 6. Watch the first few days

| Where | What you are looking for |
| --- | --- |
| `fly logs -a big-shop-api` | `lifecycle: sent <kind> to <user>`, and any `failed` lines |
| SendGrid → Activity | Deliveries, bounces, spam reports |
| SendGrid → Suppressions | Bounces accumulating means the address column is worse than assumed |

**The first week of bounce events is real information.** Open question 1 in the spec is that
nobody has ever checked whether `user.email` is complete or accurate. The design degrades
safely — a null or malformed address is a skip, not an error — but this is the first
opportunity to find out, and it is worth actually looking.

There is deliberately **no open tracking and no click tracking**, so open and click rates do
not exist and are not coming. Attribution is campaign-level `utm_*` in Google Analytics
only, and it under-counts by whatever share of visitors decline analytics consent. Know that
before reading the numbers; do not "fix" it.

---

## Turning it back off

```
ONBOARDING_EMAIL_ENABLED = "false"
```

and deploy. The flag is checked on every tick rather than only at startup, so this stops the
ticker and the welcome email immediately on the next deploy.

**What it does not do** is un-send anything, and it does not clear `email_send`. Anyone who
already received an email keeps their place in the sequence, so switching back on resumes
rather than restarting. That is almost always what you want; if it is not, the rows are
per `(user_id, kind)` and can be deleted individually.

Unsubscribes are not ours to undo — see step 4.
