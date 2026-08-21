#!/usr/bin/env bash
# Runs `docker compose` against *this worktree's* e2e stack.
#
# The project name comes from e2e/instance.cjs, the same module Playwright's
# webServer reads, so a teardown here can never hit another worktree's
# containers - which is exactly what `docker compose down --volumes` against a
# hardcoded `bigshop-e2e` used to do, mid-suite, to whoever else was running.
#
# Usage: scripts/e2e-compose.sh down --remove-orphans --volumes
#        scripts/e2e-compose.sh logs db api
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_PROJECT_NAME="$(node e2e/instance.cjs COMPOSE_PROJECT_NAME)" \
  exec docker compose "$@"
