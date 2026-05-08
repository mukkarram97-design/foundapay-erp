#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FoundaPay ERP — daily Postgres backup with structural integrity check.
#
# Reads DB creds from /var/www/foundapay/backend/.env (so the script
# survives credential rotation without edits). Writes a gzipped pg_dump
# to /var/www/foundapay/backups/, runs a structural sanity check, and
# prunes anything older than RETAIN_DAYS days.
#
# Designed for a daily cron entry like:
#   0 3 * * *  /var/www/foundapay/scripts/db-backup.sh >> /var/log/foundapay-backup.log 2>&1
#
# Verification heuristic (per project memory): we do NOT use a file-size
# threshold. We check the dump header, the trailing
# "PostgreSQL database dump complete" line, the count of CREATE TABLE
# statements (must be > 0), and the count of COPY blocks. A dump that
# fails any of these is renamed *.FAILED so the next cron tick won't
# treat it as good.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -euo pipefail

ROOT="/var/www/foundapay"
ENV_FILE="${ROOT}/backend/.env"
DEST="${ROOT}/backups"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

mkdir -p "${DEST}"

# Load DB_HOST/PORT/NAME/USER/PASSWORD from .env (export only those keys).
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[backup] .env not found at ${ENV_FILE}" >&2
  exit 2
fi
while IFS='=' read -r k v; do
  case "$k" in
    DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD) export "$k"="$v" ;;
  esac
done < <(grep -E '^(DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD)=' "${ENV_FILE}")

TS="$(date +%Y%m%d-%H%M%S)"
RAW="${DEST}/foundapay-${TS}.sql"
GZ="${RAW}.gz"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --no-owner --no-privileges --clean --if-exists \
  > "${RAW}"

# ━━━ Structural integrity check (no file-size heuristic) ━━━
fail() {
  local why="$1"
  echo "[backup] FAIL ${TS}: ${why}" >&2
  mv "${RAW}" "${RAW}.FAILED" || true
  exit 1
}

# 1. Has a recognizable pg_dump header?
head -3 "${RAW}" | grep -q "PostgreSQL database dump" || fail "missing header"

# 2. Has the canonical trailing line?
# pg_dump 17 added a \unrestrict cookie line AFTER the canonical
# "PostgreSQL database dump complete" comment, so we widen the search
# window to the last 20 lines instead of 3.
tail -20 "${RAW}" | grep -q "PostgreSQL database dump complete" || fail "missing trailer (truncated dump)"

# 3. At least one CREATE TABLE — schema actually present?
TABLE_COUNT=$(grep -c "^CREATE TABLE " "${RAW}" || true)
[[ "${TABLE_COUNT}" -gt 0 ]] || fail "zero CREATE TABLE statements"

# 4. At least one COPY block (data, not just schema)?
COPY_COUNT=$(grep -c "^COPY " "${RAW}" || true)
[[ "${COPY_COUNT}" -gt 0 ]] || fail "zero COPY blocks (no data dumped)"

# Compress + size
gzip -9 "${RAW}"
SIZE=$(stat -c %s "${GZ}")

echo "[backup] OK ${TS}: tables=${TABLE_COUNT} copy_blocks=${COPY_COUNT} size=${SIZE}B file=${GZ}"

# ━━━ Retention: prune anything older than RETAIN_DAYS days ━━━
find "${DEST}" -name 'foundapay-*.sql.gz' -type f -mtime "+${RETAIN_DAYS}" -delete -print | while read -r f; do
  echo "[backup] pruned ${f}"
done
