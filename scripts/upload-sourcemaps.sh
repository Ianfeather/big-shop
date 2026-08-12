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
# no supported way to get one back. @grafana/faro-cli exists for exactly this
# case - its `inject-bundle-id` command is documented as being for "JavaScript
# files that do not use Webpack or Rollup" - so the two steps the plugin would
# have done are done here explicitly instead.
#
# ## The two steps, and why the order matters
#
# 1. `inject-bundle-id` prepends `globalThis["__faroBundleId_bigshop-browser"]`
#    to every built chunk. At runtime @grafana/faro-core reads that same key and
#    stamps it on every error.
# 2. `upload` sends the .map files, filed under that same bundle id.
#
# The id is what ties a minified frame reported by a browser to the map that can
# resolve it. **If the two steps disagree about the id, or about the app name,
# everything still "works" - the upload succeeds, errors arrive, and every stack
# stays minified.** That is the failure mode to expect, so both values come from
# one place here rather than being typed twice.
#
# The bundle id is the deploy's git sha. It has to change whenever the bundle
# changes, or a new build's frames resolve against an old build's maps and the
# line numbers are quietly wrong - worse than no source maps at all, because it
# looks like it worked.

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

echo "Injecting Faro bundle id ${BUNDLE_ID} into ${OUTPUT_PATH}..."
npx --yes faro-cli inject-bundle-id \
  --bundle-id "$BUNDLE_ID" \
  --app-name "$APP_NAME" \
  --files "${OUTPUT_PATH}/**/*.js"

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
  --verbose

echo "Faro source maps uploaded for bundle ${BUNDLE_ID}."
