# What telemetry deliberately does not carry

Status: accepted

Three restrictions on emitted telemetry, written down because each one looks like an
oversight and will otherwise be "fixed" by someone acting reasonably.

## 1. Pseudonymous identifiers, never content

Spans and log lines carry `account.id`, the Auth0 subject, and structural counts
(`recipe.count`, `ingredient.count`, token counts, rows affected). They do **not** carry
recipe names, ingredient text, Dave chat messages, email addresses, SQL bind values, or
OpenAI prompts and completions.

The identifiers are what make after-the-fact debugging work at all — "show me everything
that happened for account 1 around 14:20" is the question the whole design exists to
answer. Content adds bulk and third-party exposure for cases that are usually reproducible
locally. Email is excluded by rule rather than by care, because it is real personal data
and appears in the Invite flow.

The cost is accepted knowingly: when an LLM extraction fails because GPT returned
unparseable JSON, the response body *is* the evidence, and it will not be in the trace.
Attaching payloads on error only was considered and rejected as too easy to apply
inconsistently across call sites.

### Google Analytics gets less, and the difference is the rule

This section was written when Grafana was the only recipient. It now governs two, and they
are not held to the same line — so "pseudonymous identifiers" is the ceiling for Grafana and
too permissive for Google.

What Big Shop *sends* to Google Analytics is: **route templates and the resolved path**
(which carries numeric Recipe ids and nothing else — query strings are stripped), **static
per-route page titles**, **`account.id` as a custom user property**, and a short fixed list
of **event names with non-content parameters** (a Recipe import's Source, for example, never
its name). It does not send the Auth0 subject, and it does not set `user_id` in GA's sense
of the term — the Account is the unit the product questions are about ("how many Accounts
have ever used Dave"), and a user property answers them without asserting a cross-device
person identity that GA would then try to stitch together.

Worth stating plainly, because a list of what we send reads as a list of what Google gets
and it is not: **gtag.js also collects things nobody here passes it** — IP address, referrer,
user agent, screen size, and a client id of its own in a cookie. That is inherent to loading
the tag at all, which is the real reason the tag is not loaded until someone agrees to it.
The restraint below is about what *this codebase* hands over on top of that.

Two consequences worth stating, because both are enforced by code that looks arbitrary
otherwise:

- **`page_title` comes from a static per-route lookup** (`lib/analytics/page-titles.ts`),
  never from `document.title`. Nothing leaks today only because every title in this app
  happens to be static, which is an accident of the current copy and not a property of the
  code — `pages/recipes/new.tsx` already passes one from a variable. A future
  `{recipe.name} — Big Shop` title would ship Recipe names to a fourth party without
  anything in the analytics code being touched. An unmapped route reports nothing at all
  rather than falling back, and a test reads the pages directory to make a missing entry
  loud.
- **Query strings are stripped from the reported path.** `?stored=new` is harmless; a
  future `?q=<search terms>` would not be, and search terms are content.

The asymmetry is deliberate. Grafana is a first-party debugging tool under contract, read by
one person, with 14-day retention; GA is a marketing product whose whole purpose is to
accumulate. The identifier that makes debugging work — "show me everything for this user
around 14:20" — has no counterpart question worth answering in GA, so it is not sent.

Consent is a further gate on top of all of this, not a substitute for it:
`specs/analytics-and-consent.md` covers when the tag loads at all.

## 2. No unbounded labels on metrics — including `account.id`

`account.id` on a *span* is free; on a *metric* it multiplies every series by the account
count, permanently, against a 10,000 active-series ceiling. The metric label sets are
bounded by design and total roughly 970 series: a duration histogram by route and status
class, an import-outcome counter by source and result, and a token counter by model and
direction.

This asymmetry is the single most likely thing to be "corrected" by a future reader who
notices the attribute on spans and adds it to metrics for consistency. It is not an
inconsistency. Spans and metrics have different cardinality economics.

Relatedly, metrics from the Netlify functions use **delta** temporality rather than the
Prometheus-default cumulative. A Lambda process dies constantly, so cumulative counters
reset endlessly and each container churns new series. Delta is the serverless-correct
choice and must be configured explicitly.

## 3. The service layer does not log

`internal/pkg/service/*` returns wrapped errors (`fmt.Errorf("adding invite: %w", err)`)
and logs nothing. A single error-recording middleware at the handler boundary calls
`span.RecordError` and sets the span status, capturing every handler error with no
per-call-site work.

This replaced roughly 70 `log.*` calls, of which 26 were a bare `log.Println(err)`
immediately before returning a 500 — carrying no route, account, user or timing that the
surrounding span does not already have. The old pattern also logged twice (service layer
and app layer) and, at `app/account.go:41`, discarded the real error and replaced it with
a guess, so a TiDB connection failure was reported as a membership problem.

An absence of logging in the service layer is therefore deliberate. The information is in
the span.
