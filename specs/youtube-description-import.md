# URL Import: read the recipe out of a YouTube description

Pasting a cooking video's URL into **URL Import** fails, every time, on every
video. The recipe is usually right there in the description; the extractor never
sees a character of it.

Scope is one thing: make `htmlToInput` recognise a YouTube watch page and hand
the extractor the video's title and description instead of the page text. No new
Import Source, no UI change, no new dependency, no API key.

## Current state

Verified against `https://www.youtube.com/watch?v=buq4Bbpe-RY` ("Jerk Marinade |
The Best Homemade Jerk Seasoning!"), whose description carries a complete
ingredient list — ~20 ingredients across a dry and a liquid section.

`pages/api/parse-recipe-url.ts:24` fetches the URL and passes the HTML to
`htmlToInput` (`lib/recipe-import/url.js:24`). On a YouTube watch page every
branch of that function comes up empty:

1. **No JSON-LD `Recipe`.** YouTube publishes `@type: VideoObject`, so
   `recipeFromJsonLd` returns `null` and we fall through to the visible-text
   path.
2. **The description is inside a `<script>`.** It lives in
   `ytInitialPlayerResponse.videoDetails.shortDescription`, and `NOISE_SELECTOR`
   (`url.js:6`) strips `script` before reading text — correctly, for every other
   site.
3. **Nothing useful renders server-side.** The watch page is client-rendered, so
   the static HTML has no description in the DOM either.

1.4 MB of HTML reduces to **210 characters**:

```
Jerk Marinade | The Best Homemade Jerk Seasoning! - YouTube
<!DOCTYPE html>
AboutPressCopyrightContact usCreatorAdvertiseDevelopersTermsPrivacyPolicy & SafetyHow YouTube works…
© 2026 Google LLC
```

The model gets a title and a cookie footer, returns no ingredients, and the 422
guard added for `follow-ups.md` #40 fires:

> Failed to fetch recipe — No ingredients could be read from that page. Try
> another link, or use Enter Manually.

That guard is behaving correctly. This is the honest failure it was built for,
not a silent empty form. The gap is upstream of it.

**Extraction is not the problem.** Pasting the same description into Manual
Entry parses cleanly today — it handled the `~` approximations, the `2-3`
ranges, the `INGREDIENTS LIST` / `LIQUID INGREDIENTS` headers, and unit
inference (Cup → 240 millilitre, "Heads" of garlic → head). Only *getting* the
description is missing.

## Proposed approach

### One branch in `htmlToInput`, ahead of the JSON-LD attempt

`htmlToInput(html)` gains an optional second argument — the URL it was fetched
from — because the decision is about which site this is, and the HTML alone is a
poor way to ask. Both callers pass it (`parse-recipe-url.ts:29`,
`parse-method-url.ts:42`); the tests that don't care keep working unchanged.

When the URL's host is a YouTube one:

1. Pull `ytInitialPlayerResponse` out of the HTML with a regex and `JSON.parse`
   it.
2. Take `videoDetails.title` and `videoDetails.shortDescription`.
3. Trim the description's boilerplate (see below).
4. Return `{ type: 'text', source: 'page', text }` shaped the same way
   `recipeToText` shapes a JSON-LD recipe — `Name:` line, then the description
   body.

Everything downstream is untouched: same `extractRecipe` call, same prompt, same
422 guard when a video genuinely has no recipe in its description.

**Fall through to the existing behaviour on any failure** — bootstrap variable
missing, JSON malformed, `shortDescription` empty. A YouTube page that has
changed shape should degrade to today's outcome (a clear 422), never to a crash.

### Trimming the description

The test video's description is 2,681 characters, of which roughly 800 are the
recipe. The rest is a Patreon link, five social links, music attribution, and an
Amazon affiliate disclaimer. Worth cutting before the LLM sees it, but cheaply
and conservatively:

- Cut at a run of separator characters (`=====`, `-----`, `_____`) once the
  description is past some minimum length — this one uses a 74-character `=`
  rule, and it is a near-universal YouTube convention.
- Drop trailing lines that are bare URLs or `Label: <url>`.

**Do not get clever here.** A trim that removes an ingredient is far worse than
one that leaves social links in — the model already ignores navigation on
scraped pages and will ignore a Patreon link. If the heuristics get fiddly,
ship without them; the token cost is trivial and correctness is not.

### Tests

`lib/recipe-import/url.test.ts` follows the established pattern: a saved
real page as a fixture in `__fixtures__/`, plus small hand-written cases. Add:

- A saved copy of the jerk marinade watch page. It must be **verbatim and at
  full size**, for the same reason the BBC Good Food fixture is — a trimmed
  fixture would pass against the broken code it exists to catch.
- Assertions that the output contains the video title and a handful of
  ingredients that appear nowhere in the page chrome (`Scotch Bonnet`,
  `Browning Sauce`, `Pimento`).
- A non-YouTube URL still taking the JSON-LD path (guards against the branch
  hijacking normal imports).
- A YouTube page with no parseable `ytInitialPlayerResponse` falling back
  rather than throwing.

No e2e test. `e2e/recipe-import.spec.ts` intercepts `/api/parse-recipe-url` and
returns canned JSON, so it exercises the form, not the extractor — this change
is entirely on the far side of that intercept.

## Decisions made

- **Scrape `ytInitialPlayerResponse`, not the YouTube Data API.** The API is the
  sturdier option — `videos.list?part=snippet` returns `description` as a
  documented field — but it needs a Google Cloud project, an API key in Netlify
  config, and a quota to reason about, for one field on one site. The regex is
  ~20 lines and no new configuration. Accepting that YouTube can break it is a
  deliberate trade; the fallback means breaking it returns us to today's
  behaviour rather than to an error.

- **`og:description` is not an option, despite looking like the obvious one.**
  Measured: YouTube truncates it to **160 characters** on both
  `og:description` and `<meta name="description">`, against 2,681 in
  `shortDescription`. It stops mid-way through the intro paragraph and never
  reaches the ingredients. Anyone reaching for the tidy solution here should
  know it was tried and doesn't work.

- **No special handling for `youtu.be`.** Measured: `fetch` follows the redirect
  to `www.youtube.com/watch?v=…&feature=youtu.be` automatically. Match on the
  host of the *fetched* URL and both forms work with one check. Note this means
  matching against `res.url`, not the string the user typed.

- **YouTube only.** TikTok and Instagram have the same shape of problem and are
  out of scope — different bootstrap, different reliability, and no evidence
  anyone wants them yet. One site, one branch, revisit on demand.

- **This is not a new Import Source.** The cook pastes a link into URL Import
  and gets a recipe. That a YouTube link needs different handling behind the
  route is an implementation detail, and putting a "YouTube" tab on the New
  Recipe page would make the user responsible for knowing it.

- **A video with no recipe in its description keeps failing.** Plenty don't have
  one. The 422 is the right answer and needs no change.

## Explicitly out of scope

- Transcripts. A recipe read aloud in the video but absent from the description
  is a much larger problem (fetching captions, far noisier extraction) and
  probably a separate spec.
- Any other video site.
- The video's thumbnail as the Recipe's image — Recipes have no image field.
- Chapter markers as Method steps.

## Things to get right when building this

- **Match on `res.url`, not the request URL.** `parse-recipe-url.ts:24` currently
  discards the response object (`await (await fetch(url)).text()`). It needs to
  keep it so the post-redirect URL reaches `htmlToInput`, otherwise `youtu.be`
  links miss the branch.

- **Do the same in `parse-method-url.ts`.** Method Import from a link has
  exactly the same bug — filling an empty Method from a YouTube link fails for
  the same reason. Both routes call `htmlToInput`; fix both, or the two paths
  drift.

- **The regex must be non-greedy and anchored on `var ytInitialPlayerResponse`.**
  The string appears more than once in the page. Verified that the target
  description contains no `};` sequence that would truncate the match early, but
  that is a property of one video, not a guarantee — hence the `try`/`catch`
  fallback rather than trusting the parse.

- **`source` stays `'page'`, not `'ingredient-list'`.** A description has a
  title, prose, and often a method, so it wants the scraped-page prompt.
  `buildFieldRules` (`extract.js:89`) reads very differently for the two, and
  `'ingredient-list'` treats every non-blank line as an ingredient — which on a
  description would turn "Enjoy!" and a Patreon URL into shopping list items.

- **Update `CONTEXT.md`'s URL Import entry** (line 90). It currently describes
  the reduction as "its schema.org JSON-LD where the site publishes one,
  otherwise the page's visible text", which will no longer be the whole truth.

- While here: `lib/recipe-import/url.js:36` leaks a literal `<!DOCTYPE html>`
  into the extractor text on every import — `node-html-parser` treats the
  doctype as a text node. Harmless, a few wasted tokens per import, trivial to
  drop in passing.
