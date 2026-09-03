#!/usr/bin/env bash
# Brings up the local MySQL + Go API stack (docker compose), waits for the API
# to be healthy, then runs the Next.js dev server natively against it.
#
# Ports default to 3308 (DB), 8080 (API), 3000 (web). If a default is already
# in use (e.g. another checkout/worktree running dev:full), the next free port
# is used automatically. Set the env vars yourself to pin specific ports:
#   DB_PORT=3309 API_PORT=8081 WEB_PORT=3002 npm run dev:full
#
# Set PIN_PORTS=true to turn that fallback off for the DB/API/web ports, so a
# port already in use is a hard error instead. The e2e suite does this: its
# caller has already told Playwright which ports to talk to, and drifting to a
# different one there does not degrade gracefully - it produces a stack nothing
# is connected to and a health check that times out for no visible reason.
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

PIN_PORTS="${PIN_PORTS:-false}"

# The three ports a caller can be holding a fixed expectation about. Grafana and
# OTLP below are deliberately left on the auto-increment path either way: they
# are only bound when START_LGTM is true, and nothing outside this script is
# told where they landed.
resolve_pinnable_port() {
  local requested="$1" service="$2"
  if ! port_in_use "$requested"; then
    echo "$requested"
    return
  fi
  if [ "$PIN_PORTS" = "true" ]; then
    cat >&2 <<MSG

Port ${requested} (${service}) is already in use, and PIN_PORTS is set, so this
script will not quietly move to another one - whoever started it is expecting
the stack on exactly that port.

If this is the e2e suite, the likely cause is either a stale stack from this
worktree:

    npm run test:e2e:stop

or another worktree whose derived port offset collides with this one (see
e2e/instance.cjs). Break the tie by naming this instance explicitly:

    E2E_INSTANCE=<something-unique> npm run test:e2e

MSG
    exit 1
  fi
  find_available_port "$requested"
}

requested_db_port="${DB_PORT:-3308}"
requested_api_port="${API_PORT:-8080}"
requested_web_port="${WEB_PORT:-3000}"
# Grafana defaults to 3200, not the 3000 specs/observability.md assumed was
# free - see the comment on the lgtm service in docker-compose.yml. 4318 is the
# OTLP receiver; the API reaches it over the compose network as lgtm:4318 and
# never through this published port, which is here for anything on the host.
requested_grafana_port="${GRAFANA_PORT:-3200}"
requested_otlp_port="${OTLP_HTTP_PORT:-4318}"

DB_PORT="$(resolve_pinnable_port "$requested_db_port" MySQL)"
API_PORT="$(resolve_pinnable_port "$requested_api_port" "the Go API")"
WEB_PORT="$(resolve_pinnable_port "$requested_web_port" "Next.js")"
GRAFANA_PORT="$(find_available_port "$requested_grafana_port")"
OTLP_HTTP_PORT="$(find_available_port "$requested_otlp_port")"

if [ "$DB_PORT" != "$requested_db_port" ]; then
  echo "Port ${requested_db_port} is in use - using ${DB_PORT} for MySQL instead."
fi
if [ "$API_PORT" != "$requested_api_port" ]; then
  echo "Port ${requested_api_port} is in use - using ${API_PORT} for the Go API instead."
fi
if [ "$WEB_PORT" != "$requested_web_port" ]; then
  echo "Port ${requested_web_port} is in use - using ${WEB_PORT} for Next.js instead."
fi
if [ "$GRAFANA_PORT" != "$requested_grafana_port" ]; then
  echo "Port ${requested_grafana_port} is in use - using ${GRAFANA_PORT} for Grafana instead."
fi
if [ "$OTLP_HTTP_PORT" != "$requested_otlp_port" ]; then
  echo "Port ${requested_otlp_port} is in use - using ${OTLP_HTTP_PORT} for OTLP/HTTP instead."
fi

export DB_PORT API_PORT GRAFANA_PORT OTLP_HTTP_PORT

# The observability stack is opt-out rather than always-on. `grafana/otel-lgtm`
# is a ~1GB image running five services, and the e2e suite - which drives this
# same script via playwright.config.ts's webServer - asserts nothing about
# telemetry. Pulling and starting it on every CI run would be minutes per run
# bought for nothing, so playwright.config.ts sets START_LGTM=false and an empty
# OTEL_EXPORTER_OTLP_ENDPOINT, which turns the SDK off in the API entirely.
#
# ADR-0007's "local LGTM for dev and e2e" is about where the Grafana Cloud
# credentials live - they exist only in production either way - so opting e2e
# out costs nothing that decision was protecting.
START_LGTM="${START_LGTM:-true}"

# `api` depends_on db being healthy, and the db healthcheck now asserts that
# the migrations actually applied (docker-compose.yml explains what it reads
# and why). So "dependency failed to start: container ... is unhealthy" here
# usually means a migration failed, not that MySQL is slow - and compose's
# message doesn't say where to look.
compose_up_failed() {
  cat >&2 <<'MSG'

docker compose could not bring the stack up. If it reported the db as
unhealthy, the cause is a migration that failed to apply - a volume that is
merely out of date is repaired by scripts/ensure-db-current.sh above, so by
this point it has been ruled out. The replay says which migration:

    docker compose logs db | grep -A20 'not in expected-migration-errors'

Fix the migration, then run this again. Recreating the volume is handled for
you: the MySQL entrypoint only replays migrations when the data directory is
empty, and ensure-db-current.sh is what empties it.
MSG
  exit 1
}

# Bring the database's schema up to date before anything waits on it being
# healthy - the healthcheck now fails on a volume that is behind migrations/,
# and this is what clears that. Near-instant and silent when there is nothing to
# do, which is the normal case; see the script's header for what it does when
# there is. It brings `db` up itself, so it has to run before the compose up
# below rather than after.
scripts/ensure-db-current.sh

# Make sure the API's database account exists before `api` tries to use it.
#
# docker/mysql-init/02-api-user.sql creates it, but the entrypoint runs
# docker-entrypoint-initdb.d exactly once in a volume's life - so every volume
# created before that file existed has the schema and not the account, and
# `api` would fail to connect with nothing explaining why. Reapplying it here is
# idempotent (CREATE USER IF NOT EXISTS) and near-instant.
#
# ensure-db-current.sh above has already brought `db` up and repaired any
# migration drift, so the database is there to talk to by this point. e2e needs
# none of this - it tears its volumes down on every run, so the entrypoint
# always runs - but it goes through this script too and the cost is one
# statement.
echo "Ensuring the API's database account exists..."
docker compose exec -T db mysql -h 127.0.0.1 -uroot -proot \
  < docker/mysql-init/02-api-user.sql 2>/dev/null \
  || echo "  could not apply docker/mysql-init/02-api-user.sql; 'api' may fail to connect" >&2

if [ "$START_LGTM" = "true" ]; then
  echo "Starting local MySQL + Go API + LGTM (docker compose)..."
  docker compose up -d --build db api lgtm || compose_up_failed
else
  echo "Starting local MySQL + Go API (docker compose); LGTM disabled."
  docker compose up -d --build db api || compose_up_failed
fi

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

# Where the *web* runtime exports its telemetry.
#
# The API container gets this from docker-compose.yml as `lgtm:4318`, over the
# compose network. Next.js runs natively on the host here (that is what keeps
# fast refresh), so it needs the published port instead - which is why this is
# set here rather than there, and why it uses OTLP_HTTP_PORT rather than a
# literal 4318: the port auto-increments on collision, and a second worktree
# would otherwise silently export into the first one's Tempo.
#
# Left alone when START_LGTM is false, so the e2e suite's empty value survives
# and lib/telemetry/setup.ts's `enabled()` turns the SDK off in Next.js exactly
# as it does in the API.
if [ "$START_LGTM" = "true" ]; then
  export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTLP_HTTP_PORT}"
fi

# Not waited on, deliberately. LGTM takes appreciably longer to come up than the
# API, and nothing should be blocked on telemetry being ready - the API is
# already serving, and a trace emitted before the collector is listening is
# dropped silently, which is exactly the designed behaviour rather than a
# failure to work around.
if [ "$START_LGTM" = "true" ]; then
  echo "Grafana on http://localhost:${GRAFANA_PORT} (may take a few seconds more)."
fi

echo "Starting Next.js on :${WEB_PORT}..."
exec npx next dev -p "${WEB_PORT}"
