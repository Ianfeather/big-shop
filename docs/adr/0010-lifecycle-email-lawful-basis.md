# Onboarding email is sent on legitimate interests, not consent

Status: accepted

Big Shop's analytics are opt-in: nothing non-essential loads until a visitor accepts, every
decision is recorded in `consent_event`, and [ADR-0008](./0008-what-telemetry-does-not-carry.md)
spends its length on what is deliberately *not* collected. The onboarding email sequence
specced in [`specs/email.md`](../../specs/email.md) does the opposite — it is sent to every
new User without asking first, on the basis of legitimate interests, with an unsubscribe in
every message.

Those two positions look inconsistent, and the inconsistency is the reason this ADR exists.
Without it, the reasonable reading is that email was built by someone who had not read the
consent work, and the reasonable fix is to bolt an opt-in checkbox onto it — which would
quietly kill the sequence.

## The two are not the same question

**Analytics consent is required by law and has no alternative basis.** UK PECR regulation 6
governs storing or accessing information on a user's device. It requires consent, full
stop; legitimate interests is not available as an alternative. That is why the analytics
work had no choice to make, and why `lib/consent.ts` has three states with `unset` as the
load-bearing one.

**Email marketing is governed by PECR regulation 22, which is a different rule with
different outs**, and — more to the point — regulation 22 covers *direct marketing*. A
service message about a service the recipient actively signed up for is not direct
marketing, and the four emails are written to stay on that side of the line: what the
product is for, how to import a recipe, some recipes to put on the list, and a request for
feedback.

So the sequence is not an exception to the consent posture. It is a different category of
message, under a different regulation, and consent is not the applicable basis for it.

## What the position is contingent on

**The sequence must stay strictly non-promotional.** No referral pitch, no upsell, no
discount, no third-party content, no "invite your friends and get X".

This is the whole load-bearing condition, and it is the one most likely to be eroded by a
reasonable-seeming edit two years from now. Add a promotional call to action and the emails
become direct marketing under regulation 22, at which point they require opt-in consent,
and the basis recorded here no longer covers them.

The condition is stated in three places on purpose — here, in `specs/email.md`, and in the
templates themselves — because the person who breaks it will be editing copy, not reading
architecture decisions.

Two further conditions, both cheap and both mandatory:

- **A working unsubscribe in every send**, honoured immediately. Implemented as a SendGrid
  ASM group, so the link, the confirmation page, the `List-Unsubscribe` headers and the
  suppression are all handled outside our code and cannot be forgotten per-template.
- **`/privacy` describes the sequence plainly**, including that the suppression list is
  permanent and is not erasable on request.

## The weakest joint

The Day 8 email — "here are some recipes to add to your list" — is content, and content
promotes the service that hosts it. A regulator taking a broad view of "direct marketing"
could read the sequence as promoting Big Shop rather than explaining it.

That is a real argument and it is recorded rather than dismissed. The judgement is that an
email teaching a new user what the product does, sent once, a week after they chose to sign
up, with a working unsubscribe, is service communication under any reasonable reading — and
that the alternative costs more than the exposure is worth.

## The alternatives, and what they cost

**Explicit opt-in — a real checkbox.** Unambiguously compliant, and consistent with how
this repo already treats analytics. Rejected on two grounds. Mechanically, Auth0's
Universal Login owns signup, so the checkbox cannot go in the signup form; it would have to
live on the one-shot onboarding screen in `pages/index.tsx`, whose continued existence
[#42](https://app.notion.com/p/3bfc724ecda181d9a6a2f4a6100d9ce2) is actively questioning.
Substantively, opt-in would cut the audience to a fraction of a user base currently
numbering tens — which is to say, possibly to nobody, at which point the sequence exists
but does not run.

**Splitting it — welcome as service, days 3/8/14 as marketing requiring opt-in.** The most
legally precise mapping of the three, and the one to revisit first if this decision ever
needs revisiting. Rejected as disproportionate to the risk: it needs two categories
modelled, two consent states stored, and it makes the welcome email's primary call to
action "tick this box" — competing with the one thing that email exists to do, which is
tell someone what to do next in the product.

**Soft opt-in** (PECR reg 22(3)) was not available. It requires the address to have been
obtained "in the course of a sale or negotiations for a sale", and Big Shop is free. Noted
because it is the obvious thing to reach for and does not apply here.

## Consequences

- The sequence reaches 100% of new signups, which is the point.
- **No open tracking and no click tracking**, decided in `specs/email.md` and reinforced
  here: a tracking pixel is what makes a service email look like marketing, so instrumenting
  these would argue against our own position. Attribution is campaign-level `utm_*` only,
  carrying no user identifier.
- Any future promotional email is a **new family** with a new basis, a new consent record,
  and its own decision. It does not inherit this one.
- The suppression list becomes a permanent record that survives Account deletion. That is
  already the position `specs/account-deletion.md` takes for its own reasons, and this
  decision depends on it: unsubscribe has to outlive the Account, or the guarantee offered
  in every send is not one.
