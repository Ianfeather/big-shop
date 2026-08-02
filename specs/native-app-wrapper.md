# Distributing Big Shop as a native app — what it would take

**Status:** Spec only. Nothing built, nothing decided.
**Date:** 2026-08-01
**Scope:** Wrapping the existing webapp natively for App Store (and Play Store)
distribution, while keeping the webapp itself as a first-class distribution channel
off the same codebase.

> **If you read one thing, read §1 and §7.** §1 is the good news: Big Shop's
> architecture is already almost exactly the shape a Capacitor wrapper wants — a
> client-rendered SPA talking to a remote HTTPS API. §7 is the bad news: the hard
> parts aren't the wrapper, they're Auth0-in-a-webview, Apple's Guideline 4.2
> "minimum functionality" bar, and two compliance blockers (in-app account deletion,
> and Sign in with Apple) that are requirements rather than nice-to-haves.

---

## 1. Where the codebase already stands

This matters more than the tooling choice, so it goes first. I read the app rather
than assuming.

| Property | Current state | Implication for wrapping |
|---|---|---|
| Rendering | Every route behind `/` is client-rendered. `pages/_app.tsx`'s `InnerApp` gates on `isAuthenticated` and returns nothing until Auth0 resolves — no server data is used to render app screens | ✅ It's effectively already an SPA. A static bundle in a webview behaves identically |
| Server-side data fetching | `getServerSideProps` appears in exactly two files, `pages/dev/api-docs.tsx` and `pages/dev/design-system.tsx`, both dev-only by design | ✅ Neither should ship in a store binary anyway |
| Data layer | TanStack Query → Go API over HTTPS at `NEXT_PUBLIC_API_HOST` | ✅ Works unchanged from a webview; it's just a cross-origin fetch |
| Auth | `@auth0/auth0-react` SPA SDK, already configured with `useRefreshTokens={true}` and `cacheLocation="localstorage"` (`pages/_app.tsx:82`) | ⚠️ Those two settings are *exactly* what native needs — but the redirect and token-storage strategy still need reworking. See §4 |
| `next/image` | Not used anywhere | ✅ Removes the usual `output: 'export'` blocker |
| PWA manifest | Already present and standalone-capable (`public/manifest.json`), with 192/512 icons and apple-touch-icon wired up in `components/layout/index.tsx` | ✅ The PWA-only option (§3, Option A) is essentially already shipped |
| Dynamic routes | `pages/recipes/[id]/index.tsx`, `.../edit.tsx` | ⚠️ The one real static-export problem. See §2 |
| LLM features | Four Next.js API routes (`parse-recipe-url`, `parse-recipe-text`, `recipe-image`, `dave/chat`) holding `OPENAI_API_KEY` server-side | ⚠️ Cannot ship inside the binary. Must stay hosted. See §2 |
| Camera | `<input type="file" accept="image/*" capture="environment">` at `pages/recipes/new.tsx:320-327` | Works in a webview, but replacing it with a native picker is the cheapest win against Guideline 4.2 (§7) |

**Read:** the wrapper itself is a small amount of work. The cost is concentrated in
auth, compliance, and the release process — not in getting the app to render.

---

## 2. Build-target work: getting a static bundle out of Next.js

The native shell needs a directory of static assets. That means `output: 'export'`,
which forces four changes.

### 2.1 Dynamic routes — the only structural change

With the Pages Router, `output: 'export'` requires `getStaticPaths` to enumerate every
path at build time. Recipe IDs are per-account, database-backed, and unknowable at
build time, so `/recipes/[id]` cannot be exported as-is.

Three ways out, in order of preference:

1. **Query-param route** — move to `/recipes/view?id=123` and `/recipes/edit?id=123`,
   reading via `router.query`. Smallest change, one file each, works identically on
   web and native. Costs you the pretty URL on web (mitigable with a Netlify rewrite
   so public URLs are unchanged and only the native build uses the flat form).
2. **Client-side route shim** — export a single catch-all shell and resolve the ID in
   the client. More machinery, keeps URLs.
3. **Keep two route trees**, one per target. Rejected — it's the version of this that
   rots.

I'd take (1). It's the only item in this whole spec that touches product URLs, so
it's worth deciding early.

### 2.2 The `pages/api/*` routes stay hosted

`output: 'export'` drops API routes entirely. That's correct here — they hold
`OPENAI_API_KEY` and must never be in a client binary. The native app points at
`https://www.bigshop.life/api/*` exactly as it points at the Go API today.

Consequence worth stating plainly: **the native app is not usable offline for recipe
import or Dave.** Only the Shopping List and cached recipes could work offline (§6).

### 2.3 Excluding dev-only surface from the binary

`pages/dev/api-docs.tsx` and `pages/dev/design-system.tsx` should be excluded from the
native build — they use `getServerSideProps` (incompatible with export) and shouldn't
be in a shipped app regardless. A side benefit: `swagger-ui-react` is a heavyweight
dependency used only by the api-docs page, and dropping it meaningfully shrinks the
bundle you're asking users to download.

### 2.4 A platform seam

The user requirement is one codebase, two targets. That wants a small abstraction —
something like `lib/platform/` exposing `camera.ts`, `auth.ts` and `storage.ts`, each
resolving to a web or native implementation at build time. Call sites (`new.tsx`'s
image handler, the auth hook) then don't branch on platform themselves.

This is deliberately a thin seam: three modules, each with one obvious interface. If
it grows past that, the wrapper is leaking and it's worth re-reading this section.

---

## 3. The four options

| | A. PWA only | B. Capacitor over remote URL | C. Capacitor over bundled export | D. React Native rewrite |
|---|---|---|---|---|
| **What it is** | What you have now — installable from Safari | Native shell whose webview loads `bigshop.life` | Native shell with the built web app inside the binary; API calls go out to the hosted backends | Native UI, shared API only |
| **Store presence** | ❌ None | ✅ (high rejection risk) | ✅ | ✅ |
| **Effort** | Zero | ~2–3 days | ~2–3 weeks | Months |
| **Guideline 4.2 risk** | n/a | **High** — this is the textbook rejection case | Manageable with native features (§7) | None |
| **Ship a web fix instantly** | ✅ | ✅ | ⚠️ Needs a release, or OTA (§8) | ❌ |
| **Works offline** | Partially | ❌ Not at all | ✅ Shell always; data with §6 | ✅ |
| **Native camera / share / push** | ❌ (push only on iOS 16.4+, installed) | ✅ via plugins | ✅ via plugins | ✅ |
| **Feels native** | Somewhat | Somewhat | Somewhat | ✅ |

**Recommendation: C.** B looks tempting for the effort saving but it is the specific
pattern Apple rejects, it breaks completely without signal, and the saving is a couple
of days. D is not justified by anything in the current product — there's no
performance problem, no animation-heavy surface, no deep OS integration in the app
today that a webview can't reach.

A is worth taking seriously as a *decision*, not a default: if the goal is "people can
install it on their phone", A already does that for free. The App Store buys you
discoverability, a trust signal, and push — and costs you everything in §7 and §8. If
you can't name which of those three you're buying, C isn't worth it yet.

---

## 4. Auth0 in a native webview — the highest-risk area

Everything else here is predictable work. This is the part that bites.

**What already helps:** `useRefreshTokens={true}` and `cacheLocation="localstorage"`
are both already set in `pages/_app.tsx`. Native has no third-party cookies, so
silent-auth-via-iframe cannot work — the refresh-token path you're already on is the
only one that does. That's a genuine head start.

**What has to change:**

1. **Origin and callback URL.** A Capacitor webview's origin is `capacitor://localhost`
   (iOS) / `https://localhost` (Android), not `https://www.bigshop.life`. The current
   `redirect_uri: process.env.NEXT_PUBLIC_HOST` (`pages/_app.tsx:79`, and again in
   `components/identity/create/index.tsx:12`) is wrong for native. Needs a
   platform-resolved value, plus new entries in the Auth0 application's Allowed
   Callback/Logout URLs and Allowed Web Origins.

2. **Login must not happen in the embedded webview.** Google explicitly blocks OAuth in
   embedded webviews (`disallowed_useragent`), and Auth0's own guidance for
   Capacitor is to hand off to the system browser. The fix is to override the SDK's
   `openUrl` to use `@capacitor/browser`, so login runs in
   `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android), then deep-link back via
   `@capacitor/app`'s `appUrlOpen` listener and call `handleRedirectCallback`. This is
   a documented pattern, not an invention — but it's the fiddliest part of the build.

3. **Token storage.** Refresh tokens in webview `localStorage` are weaker than they
   need to be on a device. Supply a custom cache backed by Capacitor Preferences or,
   better, a secure-storage plugin (Keychain / Android Keystore). Contained work —
   the SDK takes a `cache` option — but it's a security decision worth making
   deliberately rather than inheriting the web default.

4. **Long-backgrounded sessions.** A native app gets resumed weeks later far more often
   than a browser tab does. Refresh token rotation and absolute expiry need testing
   against that, with a clean re-auth path rather than a blank gated screen — note
   `InnerApp` currently renders nothing at all when unauthenticated (`pages/_app.tsx:22`),
   which is fine on web where a redirect follows immediately, and much worse as a
   cold-start experience in an app.

5. **Deep-link registration** — associated domains / custom URL scheme, plus an
   `apple-app-site-association` file if you want universal links.

**Budget this at half the total engineering time of the whole project.** It is the
thing most likely to eat a week you didn't plan for.

---

## 5. Native capabilities worth adding

Two purposes: making the app worth installing, and clearing Guideline 4.2 (§7).

| Capability | Plugin | Value | Effort |
|---|---|---|---|
| **Share-sheet ingest** — share a recipe URL from Safari/Instagram straight into Big Shop | Share extension (iOS, native code) + `@capacitor/app` | **Highest.** `parse-recipe-url` already exists; this is the missing front door to it, and it's the single most compelling reason for this app to be native | Medium–high (requires a real iOS extension target) |
| Native camera | `@capacitor/camera` | Replaces `pages/recipes/new.tsx`'s file input. Better UX, direct 4.2 answer | Low — one component, one platform module |
| Push notifications | `@capacitor/push-notifications` | Needs a server-side sender and a reason to notify. Don't build it without a product reason | Medium |
| Haptics / status bar / splash | `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/splash-screen` | Cheap polish that materially changes "is this a website?" | Very low |
| Offline shopping list | See §6 | High product value — the supermarket-with-no-signal case | High |

Share-sheet ingest and offline list are the two that make this a better product rather
than the same product in a different box. If neither is in scope, reconsider Option A.

---

## 6. Offline support (optional phase, high value)

The actual use case is standing in a supermarket with one bar of signal. Today
TanStack Query holds everything in memory with no persistence, so a cold start
offline shows nothing.

What it takes:
- `@tanstack/query-persist-client` + an async storage persister, so the Shopping List
  and recipe list survive a cold start.
- `onlineManager` wired to Capacitor's network status.
- A mutation queue with `queryClient.setMutationDefaults` so ticking items off while
  offline replays on reconnect.
- A conflict story. This is the hard bit and it's a *product* question, not a technical
  one: the Shopping List is a shared account resource (CLAUDE.md is explicit that it's
  "one mutable resource shared by the whole account"), so two people shopping
  simultaneously offline will diverge. `shopping_list_event` being an append-only log
  is a genuine asset here — it's closer to a CRDT-friendly shape than the `list` table
  is.

**Do not fold this into the wrapper phase.** It's independently valuable, it's the
largest single work item in this document, and it can ship to the webapp too.

---

## 7. App Store compliance — the requirements, including two blockers

### 7.1 Blocker: in-app account deletion (Guideline 5.1.1(v))

Apps that support account creation **must** support account deletion in-app. I grepped
`pages/account.tsx` — it handles invites, and there is no delete-account path anywhere
in the app. This needs building: a frontend flow, a Go API endpoint, and a decision
about what deletion means when an `account` is shared between users (does deleting the
last user delete the account's recipes and list? what about a user leaving a shared
account?).

That last question is a real domain design problem, not a checkbox. Budget for it.

### 7.2 Blocker (conditional): Sign in with Apple (Guideline 4.8)

If the Auth0 tenant has any third-party social login enabled (Google, Facebook, etc.),
Apple requires an equivalent privacy-preserving option — in practice, Sign in with
Apple. **Action: check which connections are enabled on the `dev-x-n37k6b` tenant
before scoping anything else.** If it's email/password only, this evaporates. If Google
is on, add an Apple connection in Auth0 plus an Apple Services ID and key.

I flagged this as conditional because I can't see the tenant config from the repo, but
it's the single most common cause of a surprise rejection for an app in this shape.

### 7.3 Guideline 4.2 — minimum functionality

"Your app should include features, content, and UI that elevate it beyond a repackaged
website." A webview pointing at a site is the canonical rejection. The defence is the
§5 list — native camera, share extension, haptics, offline — and framing the app in
review notes around what it does on-device. Option C plus two or three items from §5
clears this comfortably; Option B likely doesn't.

### 7.4 Everything else

- **Privacy manifest** (`PrivacyInfo.xcprivacy`), required since May 2024, declaring
  API usage reasons (file timestamps, user defaults) and any tracking.
- **Privacy nutrition labels** in App Store Connect. Note this app sends recipe photos
  and text to OpenAI — that's third-party data sharing and must be disclosed. Worth a
  look at whether the current privacy policy says so.
- **Permission usage strings** — `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`.
- **Age rating, support URL, privacy policy URL** — all mandatory fields.
- **Screenshots** for required device sizes, plus a 1024×1024 icon. The current
  `public/static/icon512.png` is too small; you'll need a fresh 1024 master.
- **Export compliance** — routine HTTPS-only declaration.

### 7.5 Cost

Apple Developer Program is $99/year, Google Play is a one-off $25. First review is
typically 24–48h; rejections cost a round trip each.

---

## 8. What changes about how you work

This is the part that's easy to underestimate, and it's permanent.

- **Two distribution channels, different latencies.** The webapp deploys on push. The
  native app needs a build, a submission and a review. A bug fixed in five minutes on
  web takes a day or more to reach app users.
- **Mitigation: OTA JS updates.** Apple's Guideline 3.3.2 permits updating interpreted
  code that doesn't change the app's primary purpose, which is what tools like
  `@capgo/capacitor-updater` (self-hostable) or Ionic Appflow Live Updates (paid) do.
  This is close to essential if you want to keep the current pace of change. Worth
  scoping in phase 1, not bolted on later.
- **Version skew.** Once binaries are in the wild, an old app version will call the
  current Go API. Today every client is served fresh from Netlify, so the API has never
  had to be backwards-compatible with an old frontend. That's a new constraint on API
  changes, and the OpenAPI spec being generated from `app.go` (already the case) helps.
- **A second CI path.** iOS builds need macOS runners; the existing e2e workflow on
  `ubuntu-latest` won't cover it. Playwright continues to test the web build, which
  remains a good proxy since it's the same bundle — but nothing in the current suite
  tests the native shell, and the auth flow (§4) is precisely what it can't reach.
- **Local dev gets a third mode** alongside `npm run dev` and `npm run dev:full`:
  a Capacitor sync + open-in-Xcode loop.

---

## 9. Suggested phasing

Each phase is independently shippable, and phases 0 and 1 are the cheap way to find out
whether the auth work is as bad as §4 suggests before committing to the rest.

| Phase | Work | Rough effort |
|---|---|---|
| **0. Prove the export** | `output: 'export'` behind a flag, resolve `/recipes/[id]` (§2.1), exclude `pages/dev/*`, verify the bundle runs from `file://` | 1–2 days |
| **1. Shell + auth** | Add Capacitor, iOS project, system-browser auth handoff, deep links, secure token storage. **Highest risk — do it before committing to the rest** | 3–6 days |
| **2. Compliance blockers** | Account deletion (frontend + Go endpoint + shared-account semantics), Sign in with Apple if needed | 3–5 days |
| **3. Native features** | Camera, haptics/splash/status bar, then the share extension | 4–6 days |
| **4. Release pipeline** | Certs, App Store Connect, TestFlight, privacy manifest, screenshots, OTA updates | 2–4 days + review latency |
| **5. Offline (optional)** | Query persistence, mutation queue, conflict handling | 5–10 days |

**Phases 0–4: roughly 3–4 weeks of focused work**, plus $99/year and permanent release
overhead. Phase 5 is a further 1–2 weeks and is the phase that makes it a better product.

---

## 10. Open questions

1. **Which Auth0 connections are enabled?** Decides whether §7.2 is a blocker or a
   non-issue. Cheapest thing to check, highest scope impact.
2. **What does account deletion mean** for a shared `account` with multiple
   `account_user` rows? Needs a product answer before §7.1 can be built.
3. **Is discoverability, trust, or push the reason for the App Store?** If none of them,
   the PWA already does the job (§3, Option A).
4. **Android too?** Capacitor makes it near-free once iOS is done, and Play review is
   far more forgiving. Probably yes, but it doubles the store-listing chores.
5. **Do you want pretty recipe URLs preserved on web** while the native build uses
   query params (§2.1)? Affects whether a Netlify rewrite is in scope.
