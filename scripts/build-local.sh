#!/usr/bin/env bash
# Same checks as build.sh (the Netlify build command, which needs a Go
# toolchain on the host/CI sandbox), but runs the Go steps inside the api
# container instead - for local dev machines without Go installed. Not used
# by netlify.toml; that still runs build.sh directly against Netlify's own
# Go-provisioned build image, which has no Docker available.
# ./netlify-functions/recipes is bind-mounted into that container, so `go fmt`
# still writes back to the files on disk and `go test`/`go run` see live source.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run package

echo "Starting db (docker compose)..."
docker compose up -d db

echo "Building the api image if needed..."
docker compose build api

echo "Running go fmt in the api container..."
docker compose run --rm api go fmt ./...

echo "Running go test in the api container..."
docker compose run --rm api go test ./... -v

echo "Checking docs/openapi.yaml is up to date with app.go..."
if ! diff -u docs/openapi.yaml <(docker compose run --rm api go run . openapi); then
  echo "docs/openapi.yaml is out of date. Regenerate it with:"
  echo "  docker compose run --rm api go run . openapi > docs/openapi.yaml"
  exit 1
fi
