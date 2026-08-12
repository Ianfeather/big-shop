#!/usr/bin/env bash
# Netlify's build command (netlify.toml). It builds the Next.js site and
# nothing else.
#
# It used to also run `go fmt`, `go test` and the openapi.yaml/api.d.ts drift
# checks, because Netlify's deploy build was the only place they ran at all.
# They now live in .github/workflows/ci.yml's `go` job, which runs on every pull
# request *and* on pushes to master - so they no longer depend on a Netlify
# deploy happening, and no longer need a Go toolchain provisioned here.
#
# See docs/adr/0006-go-api-leaves-netlify-functions.md: the Go API is moving to
# Fly.io, deployed by .github/workflows/deploy-api.yml.

set -e

npm run package

# After the build, because it uploads what the build produced. Never fails the
# deploy: the script exits 0 when the Grafana credentials are absent, which is
# every build made from a fork, by hand, or before Phase 5 was configured.
# Source maps are what make a Faro stack trace readable; they are not what makes
# the site work.
./scripts/upload-sourcemaps.sh
