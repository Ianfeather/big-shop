#!/usr/bin/env bash
# Fail if this branch edits history that a live database has already applied.
#
# Run on pull requests by .github/workflows/ci.yml. It needs no database and no
# secrets, because both things it checks are facts about the diff.
#
# ---------------------------------------------------------------------------
# Why a database cannot answer these, and a fresh one especially cannot
# ---------------------------------------------------------------------------
# internal/pkg/migrate refuses two situations at deploy time: a migration whose
# contents have changed since it was applied, and a pending migration that sorts
# below one already applied. Both are real, and both would otherwise corrupt the
# relationship between the repo and a long-lived schema.
#
# The trouble is *when* they are refused. deploy-api.yml runs after CI on
# master, so without this check the first report of either is a red deploy on
# master - and because that workflow only ever deploys master's tip, a stuck
# migration blocks every later merge from deploying too, not just its own.
#
# And no test environment can find them, however thorough. Every database CI
# builds is replayed from an empty directory in filename order, which is exactly
# the state in which neither problem exists: a 043 added after 044 has already
# shipped replays perfectly from scratch, and so does a migration edited long
# after it was applied. They are visible only against a database that has been
# alive across both commits - which is production, and nothing else.
#
# So they are checked here, against git, where the evidence actually is.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/master}"

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "Cannot resolve base ref '$BASE'." >&2
  echo "Pass one explicitly, e.g. ./scripts/check-migrations-append-only.sh origin/master" >&2
  exit 1
fi

# The merge base, not the base tip: comparing against the tip would report every
# migration merged into master since this branch was cut as though this branch
# had removed it.
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

status=0

# ---------------------------------------------------------------------------
# 1. Existing migrations are immutable.
# ---------------------------------------------------------------------------
# Anything but an addition: modified, deleted, renamed, or type-changed. A
# rename is included deliberately - to a database that has applied the file, a
# rename is indistinguishable from deleting one migration and adding another.
touched="$(git diff --name-status --diff-filter=MDRT "$MERGE_BASE"...HEAD -- migrations/ || true)"
if [ -n "$touched" ]; then
  echo "These already-applied migrations have been modified, deleted or renamed:" >&2
  echo >&2
  echo "$touched" | sed 's/^/    /' >&2
  echo >&2
  echo "A migration is a record of what was done to a database, not a description" >&2
  echo "of what it should look like. Production has already run these; editing one" >&2
  echo "makes the file and the schema disagree with nothing able to reconcile them," >&2
  echo "and the deploy will refuse it (internal/pkg/migrate compares checksums)." >&2
  echo >&2
  echo "Restore the file and put the change in a new migration." >&2
  status=1
fi

# ---------------------------------------------------------------------------
# 2. New migrations sort above every existing one.
# ---------------------------------------------------------------------------
# The high-water mark comes from the merge base rather than from the working
# tree, so it is "what master already has" - which is what a database that has
# been following master has applied.
highest="$(git ls-tree --name-only "$MERGE_BASE" migrations/ \
  | sed 's|^migrations/||' | grep '\.sql$' | sort | tail -1 || true)"

added="$(git diff --name-only --diff-filter=A "$MERGE_BASE"...HEAD -- migrations/ \
  | sed 's|^migrations/||' | grep '\.sql$' || true)"

if [ -n "$highest" ] && [ -n "$added" ]; then
  offenders=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # String comparison, matching the runner's own ordering rule: the numeric
    # prefix is fixed-width, which is what makes lexical order the apply order.
    if [ ! "$f" \> "$highest" ]; then
      offenders="${offenders}${f}"$'\n'
    fi
  done <<< "$added"

  if [ -n "$offenders" ]; then
    echo "These new migrations do not sort above master's highest ($highest):" >&2
    echo >&2
    printf '%s' "$offenders" | sed 's/^/    /' >&2
    echo >&2
    echo "A database that already applied $highest would build a schema no fresh" >&2
    echo "database ever passes through, since a fresh one replays in filename order." >&2
    echo "The deploy refuses this rather than producing two different schemas from" >&2
    echo "one repo." >&2
    echo >&2
    echo "Renumber them above $highest. This usually means another branch added the" >&2
    echo "same number and merged first." >&2
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "migrations/ is append-only and monotonic against $BASE."
fi
exit "$status"
