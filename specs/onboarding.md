# Onboarding: aha moments and motivations (product brief — draft)

Working notes toward a spec for the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**[#42 — Onboarding: the empty account, not the pitch, is what loses people](https://app.notion.com/p/3bfc724ecda181d9a6a2f4a6100d9ce2)**.
This is the start of a brief, not a finished spec: it captures the diagnosis and the
aha-moment/motivation framework a first design pass landed on, but the actual
step-by-step onboarding flow is not yet sequenced. Picking this back up means
starting from "design the steps," not from a blank page.

## The diagnosis (from #42, unchanged here)

Every claim the marketing page makes — ingredients adding up, aisle order, "2
tins" — needs several Recipes to be visible at all, so a new Account holding
nothing delivers none of it and asks for data entry instead. No amount of copy
fixes that; the empty Account is the funnel's actual failure point, not the
pitch in front of it. Two mechanisms already floated in #42 to attack this —
letting someone try the real URL importer before signing up, and seeding a new
Account with sample Recipes — are assumed by everything below, not
re-litigated here.

Also already shipped and load-bearing: every authenticated login now lands on
`/list`, not the marketing homepage (`3c3c724e-cda1-8083-a8ef-f2a9f6fbc165`),
and `user.onboarded` is recorded but routes nobody — onboarding is understood
to live on the list page itself, whatever shape it takes.

## What an aha moment is, here

An aha moment is a point of *unexpected* value — the product doing something
the user didn't fully expect it to do, that makes the value proposition felt
rather than described. That's a narrower thing than "a feature working" or
"a step in a flow," and it's worth being strict about the distinction: it's
what separates the two moments below from Share, which is discussed
separately because it explicitly isn't one.

Two different questions turned out to matter, and they're not the same axis:

- **Motivation** — why someone actually wants this product (their
  psychological reason for signing up).
- **Persona** — the situational narrative they arrive with (what they're
  doing right now, and where their recipes are coming from).

## Motivations and their aha moments

| Motivation | Aha | Trigger | Deliverable when |
|---|---|---|---|
| Scattered recipes (cookbooks, cards, clippings) | **Archive** — "it read my grandma's handwriting" | Photo Import, on the user's own physical recipe | Session 1, live |
| Smarter shopping | **Combine** — ingredients across recipes merge and sort into aisles unprompted | Generating a list from 2+ recipes | Session 1–2, live (needs the seeding/fast-import fix from #42 to reach this fast) |
| Cooking ruts — same few dishes on repeat | **Repertoire** — "you haven't made this in a while" / a weekly suggestion / an affordability nudge | Elapsed usage history | Can't be delivered in onboarding at all — see below |

**Archive vs. Combine, and why text entry doesn't make this list.** Typing a
recipe in by hand is an input event, not a payoff — the app now contains what
you gave it, and nothing has been handed back yet. Photo Import is different:
you point a phone at something that already existed in the physical world and
get back a structured, searchable, editable Recipe. That's the actual aha for
the "my recipes are scattered" motivation, and it's a different emotional
register from Combine's "it did the aggregation for me" — worth keeping the
two aha moments distinct in copy and demo content rather than treating Photo
Import as one input method among several.

**Combine's value doesn't strictly require overlapping ingredients** — even
recipes with nothing in common still save the manual work of compiling five
ingredient lists into one aisle-sorted trip, and near-total non-overlap is
unrealistic anyway (salt, oil, garlic, butter — see Pantry Staple in
CONTEXT.md). But the sharpest single visible beat — a quantity actually
merging on screen, "2 tins" rather than two separate lines — still depends on
at least one deliberately overlapping ingredient being present in whatever
recipes a demo or seed set uses. That's a curation task, not something to
assume happens by accident, same as `specs/featured-recipes.md` already
requires curator discipline for Featured Recipes' own combining behaviour.

**Photo Import's reliability on the actual "archive my cookbooks" inputs —
handwriting, low-light photos of a bent cookbook page — is untested as far as
this conversation could establish**, as distinct from whatever it's been
tried against so far. #42 already names the equivalent risk for URL import
(12 known-bad URLs failing silently) and is explicit that a try-it moment
that comes back empty is worse than never having offered one, because it
reads as "this doesn't work" on the one screen where that conclusion is
fatal. Worth a deliberate check against rough real-world photos before
leaning on this as a headline onboarding moment.

### Repertoire: a promise, not a demo

This one is structurally different from the other two: it can't be
*experienced* on day one at all, not just harder to design for. "You haven't
made this in a while" requires a while to have passed; a brand-new Account
has no history to be stale. Onboarding's job here is to sell the promise, not
demonstrate it — and the agreed vehicle is an **illustrated walkthrough**
(static frames, clearly labelled as an example), for two reasons: it's
honest about not being real personalised data, and it's reusable as-is in a
lifecycle email, where the templates are hand-written `html/template`,
golden-file tested, and have no client-side JS to run an interactive
component — a fixed sequence of frames is the only shape that works in both
places.

It should be **skippable, not gating** — the whole thesis of this document is
"remove friction before value," and a forced multi-screen tour standing in
front of Archive/Combine's live demos would undercut them. This also answers
one of #42's own open questions: whether the old one-shot onboarding screen
in `pages/index.tsx` is worth keeping. It isn't, as-is; replace it with
something optional and re-openable rather than a one-time gate nobody
revisits.

**Placement:** the Day 3 tips email (`specs/completed/email.md`) already
promises "the list combining itself" and "sharing an Account" in prose — no
new send needed, just an illustration for what's already there. Repertoire
isn't mentioned anywhere in the sequence yet; it fits **Day 14** ("how's it
going?") better than Day 3, since "this gets smarter the longer you use it"
said to someone three days in has nothing behind it yet, where Day 14 can
frame it as a reason to keep going.

**Not equally speculative underneath.** Two of the three example nudges ride
on data this product already collects for Dave: "haven't made this in a
while" is the literal inverse of **Recent Recipe**, and a weekly suggestion
is a selection policy over the same `shopping_list_event` data — no new
modelling, arguably Dave's roadmap rather than three new UI surfaces. "This
would be affordable because you only need X" is the odd one out: nothing
today diffs a candidate recipe's ingredients against what's already on the
list to compute a marginal add — that's new work, not a new read of existing
data.

## Share: explicitly not an aha moment

Sharing a shopping list is the literal premise of a *shared* shopping-list
app — nobody signing up is surprised the product does the thing it's named
for. That makes it Kano-shaped table stakes: its absence would be a
dealbreaker, but its presence doesn't generate delight, so it doesn't get a
moment, a walkthrough frame, or a dedicated onboarding step. It needs to be
**visible and working**, nothing more — the existing one-line mention
alongside other tips in the Day 3 email is already the right proportion.

**Hard sequencing dependency: this cannot go live anywhere in onboarding
copy until `#46` (Account invites are a broken branch of the app) actually
ships.** The invite flow 400s on every call today. Pointing at sharing before
that's fixed is the exact "empty try-it box" failure #42 already names for
URL import, wearing a different feature — worse to mention a broken thing
than not mention it at all.

## Personas: a second axis, not a fourth motivation

Two persona narratives came up, each threading through motivations already
above rather than adding a new one:

| Persona | Content source | Cadence | Ahas it threads |
|---|---|---|---|
| Family weekly shop | Recipes already held | Recurring | Combine now, Repertoire later |
| Dinner party host | Newly discovered (cookbooks, blogs, old cards) | One-off, event-driven | Archive now, Combine now |

Useful for copy and demo content — specific narratives beat one generic
walkthrough trying to speak to both. **Not recommended as an explicit
"which are you?" picker inside onboarding** — that reintroduces a decision
point standing between signup and value, which is the exact problem the rest
of this document is trying to remove. Prefer inferring it from an action
already happening: which marketing-page CTA was clicked (two CTAs could
silently tag which seed-recipe set / demo framing to use, without adding a
step), or which import path someone reaches for first (camera vs. selecting
from existing/seeded recipes). If CTA-based inference later proves too
coarse — e.g. seed recipes needing finer targeting than a two-way split —
that's a case for revisiting, not a default to build toward now.

## Explicit data capture: not in v1

Raised as an open thought, not a decision, and it's worth carrying forward as
a principle rather than resolving item by item. A four-question test for
whether something's worth asking versus inferring or not collecting yet:

1. Is there already a signal flowing through the system that answers this for
   free? (Precedent: timezone is read from the browser, never asked —
   `hooks/use-account-setup.ts`.)
2. Does anything today actually consume the answer, or would it sit unused on
   a `user` row? (Same discipline ADR-0008 already applies to telemetry
   events: don't collect ahead of a feature that needs it.)
3. Would a self-report actually beat what real usage will tell us within
   days anyway? (The lifecycle-email spec already rejected inferring
   *activation* from a behavioural threshold for the analogous reason —
   self-report at zero trust is weaker ground still.)
4. If it clears all three, can the ask ride on an action already happening
   (a CTA, a photo taken) rather than a standalone field?

Everything raised in this document — persona included — comes out on the
"infer, don't ask" side against this test. No upfront capture screen in a
first cut; any future ask needs to clear this bar rather than being added
because it seems useful.

## Adjacent work, logged separately

**[Dinner party / batch cook planner](https://app.notion.com/p/3c5c724ecda181f983acdfb56ffa1966)**
— sequencing the steps of several recipes cooked together (dinner party) or
in one session (batch cooking) came up via the dinner-party persona above,
but it's a distinct, unscoped feature idea rather than part of onboarding
itself. Logged on the board as its own backlog row rather than folded in
here.

## Not yet done

- **The actual step-by-step onboarding flow.** This document settles what the
  aha moments are and how the motivations/personas relate to them; it does
  not yet sequence what a new signup concretely walks through, in what order,
  to reach Archive and Combine live and see the Repertoire walkthrough.
- Whether the two-CTA (or first-action) persona inference is granular enough
  in practice, or needs revisiting per the explicit-capture test above.
- The mechanics of hosting a static illustration asset for the email context
  (where it needs to live, how it's referenced from `html/template`).
- Photo Import's real-world reliability on handwritten/low-quality sources,
  ahead of leaning on it as a headline moment.
