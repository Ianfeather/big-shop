#!/usr/bin/env bash
# Take a full logical backup of the production TiDB database to a local
# directory.
#
# Usage:
#   scripts/backup-prod.sh
#
# ---------------------------------------------------------------------------
# Why Dumpling and not BR
# ---------------------------------------------------------------------------
# BR is the obvious tool to reach for and it will not work here. Two reasons,
# both from PingCAP's own docs:
#
#   1. "When BR performs backup and restore tasks, it requires access to all PD
#      and TiKV nodes." TiDB Cloud exposes only the MySQL protocol endpoint on
#      port 4000 - PD and TiKV are not reachable from outside the cluster.
#   2. "Manual backups are not supported" for TiDB Cloud Starter/Essential
#      (serverless) instances; backup and restore there go through the console.
#
# There is also a trap in BR's `local://` storage: it writes to each TiKV
# node's own disk, not to the machine running the command, so even with access
# it would not produce a local backup in the sense meant here.
#
# Dumpling is TiDB's own export tool and connects over the same MySQL protocol
# port the app uses, so it works against TiDB Cloud unchanged. It produces one
# schema file and one data file per table - the same layout as the 2020-2024
# PlanetScale dumps in backups/.
#
# ---------------------------------------------------------------------------
# Where the backup goes, and why not into the repo
# ---------------------------------------------------------------------------
# Defaults to ~/big-shop-backups, deliberately OUTSIDE the working tree. A full
# backup contains the `user`, `account_user` and `invite` tables - real email
# addresses, Auth0 subject ids and invite tokens. The repo's existing backups/
# directory is tracked in git and already contains seven users' email addresses
# from 2024; there is no reason to add more. The script refuses to write inside
# the repo.
#
# Runs Dumpling in a throwaway container so nothing needs installing, matching
# how scripts/sync-from-prod.sh handles mysqldump.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

DUMPLING_IMAGE="pingcap/dumpling:v8.5.0"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/big-shop-backups}"

# TLS is required by TiDB Cloud, and the container already ships a CA bundle
# covering the public roots - TiDB Cloud's certificate is Let's Encrypt issued,
# and `openssl s_client -starttls mysql` against the gateway verifies against
# this bundle with return code 0. So the default needs no mount.
#
# Do NOT be tempted to mount the host's /etc/ssl/cert.pem here. On Docker
# Desktop for macOS /etc is a symlink to /private/etc, which is not a shared
# path: Docker silently creates an empty *directory* at the mount target rather
# than failing, and Dumpling then reports "could not read ca certificate: read
# /ca.pem: is a directory". Mounting the resolved /private path is refused
# outright.
CONTAINER_CA="/etc/ssl/cert.pem"

# Only if you genuinely need a private CA. The file is copied into the output
# directory rather than bind-mounted from wherever it lives, because that
# directory is already known to be shareable - which sidesteps the whole Docker
# Desktop file-sharing problem described above.
CA_FILE="${CA_FILE:-}"
if [ -n "$CA_FILE" ] && [ ! -f "$CA_FILE" ]; then
  echo "CA_FILE is set but $CA_FILE is not a file." >&2
  exit 1
fi

read -rp "TiDB host: " TIDB_HOST
read -rp "TiDB port [4000]: " TIDB_PORT
TIDB_PORT="${TIDB_PORT:-4000}"
read -rp "TiDB username: " TIDB_USER
read -rsp "TiDB password: " TIDB_PASSWORD
echo
read -rp "Database [bigshop]: " DB_NAME
DB_NAME="${DB_NAME:-bigshop}"

OUT_DIR="${BACKUP_ROOT}/${DB_NAME}-$(date +%Y%m%d-%H%M%S)"

# Guard: a backup full of email addresses must not land somewhere git tracks.
case "$(cd "$(dirname "$OUT_DIR")" 2>/dev/null && pwd -P || echo "$OUT_DIR")" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "Refusing to write a backup inside the repository ($OUT_DIR)." >&2
    echo "It would contain real user emails and invite tokens. Set BACKUP_ROOT elsewhere." >&2
    exit 1
    ;;
esac

mkdir -p "$OUT_DIR"

CA_IN_CONTAINER="$CONTAINER_CA"
if [ -n "$CA_FILE" ]; then
  cp "$CA_FILE" "$OUT_DIR/.ca.pem"
  CA_IN_CONTAINER="/backup/.ca.pem"
  echo "Using the CA at $CA_FILE"
fi

echo "Backing up ${DB_NAME} from ${TIDB_HOST} to ${OUT_DIR} ..."

# --consistency: "auto" resolves to TiDB's snapshot isolation, which needs no
#   locks and no privileges a TiDB Cloud user lacks. If the instance rejects it
#   ("cannot set tidb_snapshot" or similar), re-run with CONSISTENCY=none - the
#   database is small enough that a non-snapshot read is unlikely to tear.
# --compress gzip: these are text dumps and compress by roughly 5x.
# -B: this database only, so the dump does not include TiDB's system schemas.
# The password goes in via the environment and is dereferenced inside the
# container, so it never appears in the host's process list the way
# `--password "$TIDB_PASSWORD"` on the docker run line would. Hence the shell
# entrypoint: the dumpling binary lives at /dumpling and isn't on PATH.
docker run --rm \
  --entrypoint /bin/sh \
  -e TIDB_PASSWORD="$TIDB_PASSWORD" \
  -v "$OUT_DIR:/backup" \
  "$DUMPLING_IMAGE" \
  -c '/dumpling \
    --host "$0" \
    --port "$1" \
    --user "$2" \
    --password "$TIDB_PASSWORD" \
    --ca "$5" \
    --database "$3" \
    --output /backup \
    --filetype sql \
    --consistency "$4" \
    --compress gzip' \
  "$TIDB_HOST" "$TIDB_PORT" "$TIDB_USER" "$DB_NAME" "${CONSISTENCY:-auto}" "$CA_IN_CONTAINER"

rm -f "$OUT_DIR/.ca.pem"

echo
echo "Done. Files:"
ls -lh "$OUT_DIR" | tail -n +2 | awk '{printf "  %-52s %s\n", $9, $5}'
echo
echo "Total: $(du -sh "$OUT_DIR" | cut -f1)"
echo
echo "⚠  This backup contains real user emails, Auth0 ids and invite tokens."
echo "   Keep it out of the repository and off anything shared."
echo
echo "To restore into your local dev database:"
echo "   gunzip -c ${OUT_DIR}/*.sql.gz | docker compose exec -T db mysql -uroot -proot ${DB_NAME}"
echo
echo "To restore into a fresh TiDB Cloud instance, use TiDB Lightning or the"
echo "console's import - a plain mysql client replay works for a database this"
echo "size but has no resume-on-failure."
