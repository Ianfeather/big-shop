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
