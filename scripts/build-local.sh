#!/usr/bin/env bash
# The full local check suite: `npm run package` plus the Go steps that
# .github/workflows/ci.yml's `go` job runs in CI - but inside the api
# container's Go toolchain, for dev machines without Go installed.
#
# This used to mirror build.sh, back when build.sh ran the Go checks too.
# It no longer does: those checks moved to CI when the API left Netlify
# Functions (docs/adr/0006-...), and build.sh reduced to `npm run package`.
# So this script's counterpart is now ci.yml, and the two should stay in step.
# ./netlify-functions/recipes is bind-mounted into that container, so `go fmt`
# still writes back to the files on disk and `go test`/`go run` see live source.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run package

echo "Starting db (docker compose)..."
docker compose up -d db

echo "Building the api image if needed..."
docker compose build api

# `gofmt -l` rather than `go fmt ./...`, matching ci.yml: `go fmt` rewrites the
# files and exits 0 whatever it found, so as a gate it always passed. This
# reports and fails instead - which is what CI will do to you otherwise.
echo "Checking gofmt in the api container..."
unformatted="$(docker compose run --rm -T api gofmt -l .)"
if [ -n "$unformatted" ]; then
  echo "These files are not gofmt'd:"
  echo "$unformatted"
  echo "Fix with: docker compose run --rm api go fmt ./..."
  exit 1
fi

echo "Running go vet in the api container..."
docker compose run --rm api go vet ./...

echo "Running go test in the api container..."
docker compose run --rm api go test ./... -v

echo "Checking docs/openapi.yaml is up to date with app.go..."
# -T: without it compose allocates a TTY and injects carriage returns into the
# captured stdout, so the diff fails on line endings alone.
if ! diff -u docs/openapi.yaml <(docker compose run --rm -T api go run . openapi); then
  echo "docs/openapi.yaml is out of date. Regenerate it with:"
  echo "  docker compose run --rm api go run . openapi > docs/openapi.yaml"
  exit 1
fi

echo "Checking types/api.d.ts is up to date with docs/openapi.yaml..."
if ! diff -u types/api.d.ts <(npx openapi-typescript docs/openapi.yaml); then
  echo "types/api.d.ts is out of date. Regenerate it with:"
  echo "  npm run generate:api-types"
  exit 1
fi
