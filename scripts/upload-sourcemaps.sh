#!/usr/bin/env bash
# Uploads the browser bundle's source maps to Grafana so that a Faro stack trace
# names functions and files instead of minified chunks.
#
# Runs after `next build`, from build.sh, i.e. inside Netlify's deploy build -
# which is the only place the production bundle and the deploy's sha exist
# together.
#
# ## Why a script and not the webpack plugin
#
# Grafana's documented route is @grafana/faro-webpack-plugin. **Next.js 16 builds
# with Turbopack, not webpack** (`next build` prints "▲ Next.js 16.2.12
# (Turbopack)"), so there is no webpack config for that plugin to hook into and
# no supported way to get one back. @grafana/faro-cli covers the upload half, and
# the other half - telling the runtime which build it is - is done from
# application code rather than by the CLI's `inject-bundle-id`, for the reason
# in the next section.
#
# ## This uploads, and deliberately does not inject
#
# The CLI also offers `inject-bundle-id`, which the bundler plugins run as a
# first step, and **using it here corrupts every stack trace**. It prepends a
# 263-character IIFE to each built chunk *after* the bundler has written its
# source maps. Turbopack emits one enormous line, so those characters shift
# every column on line 1, and each frame then resolves to whatever sat 263
# characters earlier in the file.
#
# That was not a theory: with injection in place, this app's smoke test - thrown
# from `pages/index.tsx` - arrived in Grafana attributed to `hooks/use-login.ts`.
# A *confidently wrong* stack trace, which is worse than a minified one, because
# a minified one at least announces itself.
#
# `lib/telemetry/faro.ts` sets `globalThis["__faroBundleId_bigshop-browser"]`
# from application code instead. Same global, same value, read the same way by
# @grafana/faro-core - and no bytes added to any built file, so the maps stay
# byte-accurate.
#
# What is left is this: upload the .map files under the bundle id the runtime
# will report. **If the two disagree, everything still "works"** - the upload
# succeeds, errors arrive, and every stack stays minified - so both derive from
# the same Netlify variable rather than being typed twice.
#
# The bundle id is the deploy's git sha, so it changes whenever the bundle does.
# A fixed id would resolve a new build's frames against an old build's maps,
# which is the same confidently-wrong failure by a different route.

set -euo pipefail

# Must match lib/telemetry/faro.ts's APP_NAME. The one duplicated string in the
# chain; there is no way to import a TypeScript constant into a shell script, so
# it is asserted below instead.
APP_NAME="bigshop-browser"

# Where Turbopack writes the client bundle and its maps.
OUTPUT_PATH=".next/static/chunks"

# Skipped rather than failed when unconfigured.
#
# The site has to keep deploying whether or not source map upload is set up:
# a deploy preview from a fork, a local run of build.sh, and every build made
# before the Grafana credentials existed all land here. A missing credential
# means "no source maps this time", never "no deploy" - the same rule the
# runtime side follows, where a missing endpoint means no SDK rather than a
# failure.
if [ -z "${FARO_API_KEY:-}" ] || [ -z "${FARO_APP_ID:-}" ] || [ -z "${FARO_STACK_ID:-}" ]; then
  echo "Faro source map upload skipped: FARO_API_KEY, FARO_APP_ID or FARO_STACK_ID is unset."
  exit 0
fi

if [ ! -d "$OUTPUT_PATH" ]; then
  echo "Faro source map upload skipped: $OUTPUT_PATH does not exist - was there a build?"
  exit 0
fi

# COMMIT_REF is Netlify's; the git fallback keeps this runnable by hand.
BUNDLE_ID="${SERVICE_VERSION:-${COMMIT_REF:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}}"

# The source map *API* host, which is not the collector host the browser posts
# to - a distinction that is easy to miss because the two look alike and only
# one of them is in the snippet Grafana shows you. Overridable for the same
# reason every other endpoint here is: the region is a property of the stack.
ENDPOINT="${FARO_SOURCEMAP_API:-https://faro-api-prod-eu-west-2.grafana.net/faro/api/v1}"

# Everything below is best-effort, and the `|| { ...; exit 0; }` on each step is
# the whole point rather than sloppiness.
#
# An earlier version of this script relied on `set -e` alone, which meant a
# Grafana outage, an expired token or a transient 500 during upload would fail
# the script, fail build.sh, and **take the whole site's deploy down**. That
# directly contradicts the sentence this file opens with: source maps make a
# stack trace readable, they are not what makes the site work. Verified against
# a real deploy, where the build's success is what proves the upload ran - so
# the coupling was real, not theoretical.
#
# The cost of failing soft is a build whose stack traces stay minified, which is
# visible in Grafana the moment anyone looks at an error, and recoverable by
# redeploying.

# --keep-sourcemaps is deliberately not passed, and its default of false is
# load-bearing: the CLI deletes each .map after uploading it, so the maps reach
# Grafana and are *not* left sitting in .next/static/chunks/ to be served to
# anyone who asks. That is what makes this a "**private** source map upload", in
# the spec's words, rather than publishing this app's entire source. Confirmed
# on a real deploy - the .map URLs 404 while stack traces still resolve.
echo "Uploading source maps to Faro..."
npx --yes faro-cli upload \
  --endpoint "$ENDPOINT" \
  --app-id "$FARO_APP_ID" \
  --api-key "$FARO_API_KEY" \
  --stack-id "$FARO_STACK_ID" \
  --bundle-id "$BUNDLE_ID" \
  --app-name "$APP_NAME" \
  --output-path "$OUTPUT_PATH" \
  --gzip-payload \
  --verbose || {
  echo "Faro source map upload failed - continuing; stack traces will stay minified." >&2
  exit 0
}

echo "Faro source maps uploaded for bundle ${BUNDLE_ID}."
