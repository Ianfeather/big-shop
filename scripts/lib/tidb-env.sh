#!/usr/bin/env bash
# Shared TiDB connection details for the scripts that talk to production.
#
# Source it, then call the two functions:
#
#   . "$(dirname "$0")/lib/tidb-env.sh"
#   tidb_env_load       # TIDB_HOST/PORT/USER/DB, from the environment
#   tidb_env_prefer_user TIDB_READONLY_USER   # optional; see below
#   tidb_prompt_password  # TIDB_PASSWORD, typed silently, held in memory only
#
# ---------------------------------------------------------------------------
# Why the two are separate calls
# ---------------------------------------------------------------------------
# So a caller can do all of its own validation - the "is this path inside the
# repo" guard in backup-prod.sh, for instance - between knowing where it is
# connecting and asking a human to type a password. Prompting first and then
# refusing to run wastes the one step that cannot be automated away.
#
# ---------------------------------------------------------------------------
# Where the values come from
# ---------------------------------------------------------------------------
# `.env.tidb` at the repo root, which is **tracked in git** like
# `.env.development` and `.env.production` are. None of what it holds is a
# secret: a hostname, a port, a username and a database name identify the
# instance but grant nothing without the password, which is not in there and
# never will be. Checking them in is what makes these scripts a one-liner on a
# fresh clone instead of four questions every run.
#
# Anything already exported in the environment wins over the file, so a one-off
# run against a different instance is `TIDB_HOST=other scripts/check-orphans.sh`
# with nothing edited and nothing to put back afterwards.
#
# The password is read from neither. It is typed on every run and lives only in
# this shell's memory for as long as the script does - the posture
# docker/README.md has always documented, and the reason none of these scripts
# ever put a password on a command line.
#
# The file is parsed, not sourced. A plain `source` would execute whatever
# ended up in it, including a value pasted out of a console with a `$(...)`
# somewhere in it.

# Resolve the repo root from this file's own location, so it does not matter
# what the caller has cd'd to.
TIDB_ENV_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

# The TIDB_USER the caller had already exported, captured now - before
# tidb_env_load fills the variable in from .env.tidb. Once that has run there is
# no way to tell a username a person chose deliberately from the file's default,
# and tidb_env_prefer_user needs to treat the two in opposite ways.
#
# Sourcing this file is the last moment that distinction still exists, which is
# why the capture lives here rather than in the function that uses it. It used
# to be a `caller_user` local in migrate-prod.sh, which meant every script
# wanting the same behaviour had to remember to capture before sourcing.
TIDB_ENV_CALLER_USER="${TIDB_USER:-}"

# Read KEY=VALUE lines from $1 into the environment, without overwriting
# anything already set to a non-empty value.
tidb_env_read_file() {
  local file="$1" line key value
  [ -f "$file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"   # strip leading whitespace
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"

    key="${line%%=*}"
    [ "$key" = "$line" ] && continue          # no '=' on the line at all
    value="${line#*=}"

    key="${key%"${key##*[![:space:]]}"}"      # strip trailing whitespace
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    # Treat set-but-empty as unset: an exported TIDB_HOST= should not defeat
    # the file it was presumably meant to be read from.
    if [ -z "${!key:-}" ]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done < "$file"
}

# TIDB_HOST, TIDB_PORT, TIDB_USER and TIDB_DB, or a usable error.
tidb_env_load() {
  tidb_env_read_file "$TIDB_ENV_REPO_ROOT/.env.tidb"

  # 4000 is TiDB Cloud's protocol port, not MySQL's usual 3306.
  TIDB_PORT="${TIDB_PORT:-4000}"
  TIDB_DB="${TIDB_DB:-bigshop}"

  local missing=""
  [ -n "${TIDB_HOST:-}" ] || missing="TIDB_HOST"
  [ -n "${TIDB_USER:-}" ] || missing="${missing:+$missing }TIDB_USER"

  if [ -n "$missing" ]; then
    echo "Missing required connection detail(s): $missing" >&2
    echo >&2
    echo "Set them in $TIDB_ENV_REPO_ROOT/.env.tidb (tracked in git - none of" >&2
    echo "it is secret), or export them for a one-off run." >&2
    echo >&2
    echo "Both can be read out of the production DSN in Netlify's environment" >&2
    echo "variables UI: user:password@tcp(host:port)/bigshop?..." >&2
    echo "See docker/README.md, 'Connection details'." >&2
    exit 1
  fi

  export TIDB_HOST TIDB_PORT TIDB_USER TIDB_DB
}

# Point TIDB_USER at the narrower, role-specific account named by $1 - a
# variable name, e.g. `tidb_env_prefer_user TIDB_READONLY_USER`.
#
# ---------------------------------------------------------------------------
# Why the scripts do not simply share .env.tidb's TIDB_USER
# ---------------------------------------------------------------------------
# Because they do very different things to production, and one username cannot
# be right for all of them. TIDB_USER names **root**, and has to, because
# backup-prod.sh dumps the whole database and probe-charset-conversion.sh runs
# ALTER. A script that only ever reads inherited that anyway, so every one of
# these sessions was a root session regardless of what it needed.
#
# So each script that has a narrower account available asks for it by name, and
# .env.tidb carries one line per role. root stays the default for the scripts
# that genuinely need it rather than being the default for everything.
#
# ---------------------------------------------------------------------------
# Why an explicitly exported TIDB_USER still wins
# ---------------------------------------------------------------------------
# `TIDB_USER=... scripts/check-orphans.sh` is how you deliberately connect as
# somebody else - as root to compare, or as a fifth account that does not exist
# yet. Silently overriding that would make the override look broken.
#
# The distinction is only observable before tidb_env_load runs, which is why it
# is captured at source time into TIDB_ENV_CALLER_USER above.
#
# Both no-op branches return 0 deliberately: every caller runs under `set -e`,
# so a function returning non-zero as its last act would abort the script.
tidb_env_prefer_user() {
  local var="$1"

  # The caller chose a username; leave it alone.
  if [ -n "${TIDB_ENV_CALLER_USER:-}" ]; then
    return 0
  fi

  # No such account configured - .env.tidb's line is absent or commented out.
  # Falling back to TIDB_USER keeps the script working exactly as it did
  # before the narrower account existed, which is what makes adding one a
  # change that can be merged before the account is created.
  if [ -z "${!var:-}" ]; then
    return 0
  fi

  TIDB_USER="${!var}"
  export TIDB_USER
}

# TIDB_PASSWORD, typed silently. Never defaulted from the environment or the
# file - see the header.
tidb_prompt_password() {
  if [ ! -t 0 ]; then
    echo "Cannot prompt for the TiDB password: stdin is not a terminal." >&2
    echo "These scripts are interactive by design; the password is never read" >&2
    echo "from the environment or from a file." >&2
    exit 1
  fi

  read -rsp "TiDB password for ${TIDB_USER}@${TIDB_HOST}: " TIDB_PASSWORD
  echo

  if [ -z "$TIDB_PASSWORD" ]; then
    echo "No password entered." >&2
    exit 1
  fi
}
