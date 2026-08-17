# Rendering stored content safely

Big Shop stores prose it did not write and renders it to people who did not
author it. This document records the invariant that keeps that safe, the audit
that confirmed it holds (2026-08-17), and — the part worth reading before
changing anything nearby — the specific future changes that would break it.

It exists because the codebase was safe largely *by accident*: several paths
were inert because of what a guard happened to allow rather than because of
what it was written to exclude, and an accident holds only until someone
reasonable changes something next to it.

## The invariant

**No rendering path in this application may introduce raw HTML.** React escapes
its children, and that escaping is the entire defence. Concretely:

1. **No `dangerouslySetInnerHTML` may take stored data.** The prop is not
   banned outright — `pages/_document.tsx` has a legitimate use — but its input
   must be a build-time constant, never anything that has been through the
   database, an LLM, or a request.
2. **No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`**,
   at all.
3. **A URL from stored data that becomes an attribute must be scheme-tested**
   against an allowlist before it is rendered. There is exactly one such path
   today (below). A test on the scheme, anchored — not a prefix test that
   excludes `javascript:` as a side effect.
4. **No markdown or rich-text renderer may be added without sanitisation
   designed in**, not added afterwards. See "What would break this" below.

## Why the threat model is not the usual one

The obvious reading — a user typing `<script>` into their own recipe and
attacking themselves — is the least interesting case here, and reasoning from
it under-rates the problem in two ways.

**The stored content is not user-authored.** Recipe names, ingredient text and
Method prose arrive from **LLM extraction of arbitrary third-party web pages**:
URL Import, Photo Import, paste-a-recipe. The injection source is therefore not
a Big Shop user at all — it is any page on the internet, laundered through a
model that is explicitly trying to reproduce that page's text faithfully. A
model doing its job well will carry a payload through verbatim. Prompt
injection and script injection are the same input here.

**The content is shared.** An Account has several Users — that is the product,
per [CONTEXT.md](../CONTEXT.md). Content one person imports renders in another
person's browser. That is the "stored" half of stored XSS and the half that
makes it worth more than a self-inflicted `alert(1)`.

## The audit

Checked by hand on 2026-08-17, on branch `stored-xss-audit`, over
`components/`, `pages/`, `lib/` and `hooks/`.

### Raw HTML sinks — one, and it takes no stored data

`pages/_document.tsx` renders the auth-hint script with
`dangerouslySetInnerHTML`. Its only interpolation is
`${JSON.stringify(clientId)}`, where `clientId` is
`process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID` — deploy-time configuration that
never passes through the database or a request. Safe, and safe for a structural
reason rather than an incidental one.

Worth knowing if that script ever grows: `JSON.stringify` is *not* on its own a
complete guard for embedding in a `<script>` element. It does not escape
`</script>`, which closes the element regardless of JavaScript string context,
and it passes U+2028/U+2029 through. Neither matters for an Auth0 client ID.
Both would matter the moment anything less trusted is interpolated there — so
that is the line: **that script may interpolate build-time config and nothing
else.**

No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` anywhere
in application code. (`lib/analytics/ga.test.ts` clears `document.head.innerHTML`
in a test setup; not a render path.)

### The one href built from stored data

`components/recipe/index.tsx`'s `RecipeLink` renders a Recipe's `remoteUrl` as
an `<a href>`. That field is a free-text `<input type="text">` on the recipe
editor with no validation on the way in, so it holds whatever was typed or
whatever an import produced — and because an Account is shared, the person
clicking it need not be the person who supplied it.

It previously guarded with `link.match(/^http/)`. That did exclude
`javascript:` and `data:`, so there was no live hole; but it excluded them as a
consequence of what it happened to allow, and it admitted values like
`httpjavascript:` and `http-evil:` as hrefs. It now tests
`/^https?:\/\//i`. Anything failing the test renders as plain text, which React
escapes. Covered by `components/recipe/index.test.tsx`, including the two
strings the old prefix test let through.

### Dave

`components/dave-chat/index.tsx` renders model output as `{message.content}` —
a plain React child, escaped. This is the highest-risk surface in the
application (a model's output, rendered directly) and it is safe for the least
durable reason available: **nobody has yet asked for Dave to emit formatted
output.** There is no markdown renderer in the dependency tree.

### Images and uploads

There is no `<img>` tag and no `next/image` usage that renders stored data
anywhere in the app. Recipes have no stored image that is served back.

This answers the SVG question that prompted the audit. `pages/api/recipe-image.ts`
validates uploads with `file.mimetype?.startsWith('image/')`, which does admit
`image/svg+xml` — an SVG can carry script, so that check alone would not be
sufficient if the file were ever served back to a browser as a document. It is
not. The upload is base64-encoded, sent to OpenAI, and discarded; only the
extraction *result* is written to Netlify Blobs. There is no rendering context,
so there is no vulnerability — but note that the safety comes from the absence
of a serving path, not from the mimetype check. **Serving uploaded images back
would need this revisited**, and the mimetype check tightened to a real
allowlist, before it shipped.

(In the browser, `lib/resize-image.ts` re-encodes uploads through a `<canvas>`
to `image/jpeg` first. That happens to rasterise an SVG, but it is a size
optimisation, not a security control, and it is client-side — do not rely on
it.)

### Untrusted HTML reaching a parser

`lib/recipe-import/url.js` runs `node-html-parser` over attacker-controlled
HTML server-side (`parse(html)` at line 25, and `plainText()` at line 113,
which uses `.structuredText` to strip markup out of JSON-LD strings). This is
not a render path and not XSS. It is in scope for this document because it is
the same untrusted input reaching a parser, and because `structuredText`
returning text rather than markup is load-bearing for everything downstream of
it.

## What would break this

Two foreseeable changes, both plausible, both of which need sanitisation
designed in rather than bolted on afterwards:

- **A markdown renderer for Dave.** The single change that would turn the app's
  most exposed surface from inert into a live sink.
- **Rich-text or structured Method.** Board item #41 notes that migration 031
  wrote 56 methods in `"1. … 2. …"` shape, which sharpened the question of
  whether steps should be structured data. `components/recipe/index.tsx`'s
  `parseMethodSteps` already parses that prose client-side. A rich-text answer
  to that question is exactly where this bites.

If either lands, the requirement is an allowlist-based sanitiser applied at
render, not at write — content already in the database predates any rule added
now.

## Re-running the audit

```bash
# 1. Raw HTML sinks. Expect only pages/_document.tsx.
grep -rn "dangerouslySetInnerHTML\|\.innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" \
  components/ pages/ lib/ hooks/

# 2. Attributes built from a variable. Every hit must be internal routing or
#    scheme-tested.
grep -rn "href={\|src={\|action={" components/ pages/

# 3. A markdown or HTML renderer entering the dependency tree.
grep -nE '"(.*markdown.*|.*sanitiz.*|.*purify.*|.*html.*)"' package.json
```

`components/recipe/index.test.tsx` pins the `RecipeLink` scheme test and the
escaping of extracted prose, so a regression in the one guarded path fails the
unit suite rather than waiting for this document to be re-read.
