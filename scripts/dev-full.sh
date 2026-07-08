#!/usr/bin/env bash
# Brings up the local MySQL + Go API stack (docker compose), waits for the API
# to be healthy, then runs the Next.js dev server natively against it.
#
# Override ports if the defaults clash with another checkout/worktree:
#   DB_PORT=3309 API_PORT=8081 WEB_PORT=3002 npm run dev:full
set -euo pipefail
cd "$(dirname "$0")/.."

DB_PORT="${DB_PORT:-3308}"
API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"
export DB_PORT API_PORT

echo "Starting local MySQL + Go API (docker compose)..."
docker compose up -d --build db api

echo "Waiting for the API on :${API_PORT}..."
health_url="http://localhost:${API_PORT}/.netlify/functions/recipes/health"
for _ in $(seq 1 60); do
  if curl -sf "$health_url" > /dev/null 2>&1; then
    echo "API is up."
    break
  fi
  sleep 1
done
if ! curl -sf "$health_url" > /dev/null 2>&1; then
  echo "API did not become healthy in time - check 'docker compose logs api'." >&2
  exit 1
fi

export NEXT_PUBLIC_API_HOST="http://localhost:${API_PORT}/.netlify/functions/recipes"
export NEXT_PUBLIC_HOST="http://localhost:${WEB_PORT}"

echo "Starting Next.js on :${WEB_PORT}..."
exec npx next dev -p "${WEB_PORT}"
