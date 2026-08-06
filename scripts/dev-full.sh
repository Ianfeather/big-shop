#!/usr/bin/env bash
# Brings up the local MySQL + Go API stack (docker compose), waits for the API
# to be healthy, then runs the Next.js dev server natively against it.
#
# Ports default to 3308 (DB), 8080 (API), 3000 (web). If a default is already
# in use (e.g. another checkout/worktree running dev:full), the next free port
# is used automatically. Set the env vars yourself to pin specific ports:
#   DB_PORT=3309 API_PORT=8081 WEB_PORT=3002 npm run dev:full
set -euo pipefail
cd "$(dirname "$0")/.."

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

find_available_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

requested_db_port="${DB_PORT:-3308}"
requested_api_port="${API_PORT:-8080}"
requested_web_port="${WEB_PORT:-3000}"

DB_PORT="$(find_available_port "$requested_db_port")"
API_PORT="$(find_available_port "$requested_api_port")"
WEB_PORT="$(find_available_port "$requested_web_port")"

if [ "$DB_PORT" != "$requested_db_port" ]; then
  echo "Port ${requested_db_port} is in use - using ${DB_PORT} for MySQL instead."
fi
if [ "$API_PORT" != "$requested_api_port" ]; then
  echo "Port ${requested_api_port} is in use - using ${API_PORT} for the Go API instead."
fi
if [ "$WEB_PORT" != "$requested_web_port" ]; then
  echo "Port ${requested_web_port} is in use - using ${WEB_PORT} for Next.js instead."
fi

export DB_PORT API_PORT

echo "Starting local MySQL + Go API (docker compose)..."
docker compose up -d --build db api

# The health poll, the browser and server-side code all address the API through
# the same base URL here, so it is composed once - the router's base path
# (main.go's basePath) appears in enough places already without this script
# holding three copies of it.
#
# The two variables are the same value locally and deliberately different in
# production, where NEXT_PUBLIC_API_HOST is the relative /api/bigshop and
# API_HOST_INTERNAL names the Fly origin. Setting both here means local dev and
# e2e exercise the variable production's server-side code actually reads, rather
# than only lib/api-host.ts's fallback.
export NEXT_PUBLIC_API_HOST="http://localhost:${API_PORT}/api/bigshop"
export API_HOST_INTERNAL="$NEXT_PUBLIC_API_HOST"

echo "Waiting for the API on :${API_PORT}..."
health_url="${NEXT_PUBLIC_API_HOST}/health"
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

export NEXT_PUBLIC_HOST="http://localhost:${WEB_PORT}"

echo "Starting Next.js on :${WEB_PORT}..."
exec npx next dev -p "${WEB_PORT}"
