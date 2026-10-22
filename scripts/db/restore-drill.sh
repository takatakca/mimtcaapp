#!/usr/bin/env bash
# Restore drill: proves a MIMT Postgres backup can actually be restored. Restores a dump into a THROWAWAY
# PostgreSQL database, then checks the schema and data look like MIMT production. Never touches production.
#
#   DRILL_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres scripts/db/restore-drill.sh backup.dump
#
# Accepted dumps: pg_dump custom format (.dump / Coolify .dmp), gzip-compressed custom or plain SQL, plain SQL,
# and age-encrypted archives from scripts/db/backup-mimt.sh when MIMT_BACKUP_AGE_IDENTITY_FILE points to the
# private key file. The database host must be local (127.0.0.1, localhost or a socket): drills run on scratch servers.
# DRILL_DATABASE_URL must be a superuser connection to a maintenance database; the drill creates and drops
# its own database (mimt_restore_drill).
set -Eeuo pipefail
umask 077

die() { printf 'restore drill FAILED: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || die "usage: restore-drill.sh <dump-file>"
dump="$1"
[[ -s "$dump" ]] || die "dump file is missing or empty: $dump"
[[ -n "${DRILL_DATABASE_URL:-}" ]] || die "DRILL_DATABASE_URL is required (throwaway server, superuser)"
host="$(printf '%s' "$DRILL_DATABASE_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]*).*#\2#')"
[[ "$host" == "127.0.0.1" || "$host" == "localhost" || -z "$host" ]] || die "refusing a non-local database host ($host): drills only run on scratch servers"
for cmd in psql pg_restore createdb dropdb gzip mktemp; do command -v "$cmd" >/dev/null || die "missing $cmd"; done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d -t mimt-drill-XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
db="mimt_restore_drill"
admin_url="$DRILL_DATABASE_URL"
drill_url="$(printf '%s' "$DRILL_DATABASE_URL" | sed -E "s#/[^/?]*(\?|$)#/$db\1#")"

# 1. Decrypt / decompress into a plain archive.
src="$dump"
if head -c 22 "$src" | grep -q "age-encryption.org"; then
  [[ -n "${MIMT_BACKUP_AGE_IDENTITY_FILE:-}" ]] || die "dump is age-encrypted: set MIMT_BACKUP_AGE_IDENTITY_FILE"
  command -v age >/dev/null || die "missing age"
  age -d -i "$MIMT_BACKUP_AGE_IDENTITY_FILE" -o "$work/dump" "$src"
  src="$work/dump"
fi
if [[ "$(head -c 2 "$src" | od -An -tx1 | tr -d ' ')" == "1f8b" ]]; then
  gzip -dc "$src" >"$work/dump.unzipped"
  src="$work/dump.unzipped"
fi
format="sql"
[[ "$(head -c 5 "$src")" == "PGDMP" ]] && format="custom"
echo "dump: $(wc -c <"$dump") bytes, format $format"

# 2. Fresh database with the cluster roles production policies refer to (see deploy/coolify/mimt-postgres-bootstrap.sql).
dropdb --if-exists --maintenance-db="$admin_url" "$db"
createdb --maintenance-db="$admin_url" "$db"
psql -v ON_ERROR_STOP=1 -q "$admin_url" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
SQL

# 3. Restore. Ownership and grants are skipped: the drill only proves the data comes back.
if [[ "$format" == "custom" ]]; then
  pg_restore --no-owner --no-acl --exit-on-error --dbname="$drill_url" "$src" || die "pg_restore failed"
else
  psql -v ON_ERROR_STOP=1 -q "$drill_url" -f "$src" >/dev/null || die "SQL restore failed"
fi

# 4. Sanity checks: every migration recorded, core tables present and readable.
expected="$(sed -n '/MIGRATION_ORDER = \[/,/\]/p' "$root/apps/api/src/jobs/migrateStandalone.ts" | grep -oE '"[0-9]{4}_[a-z0-9_]+\.sql"' | tr -d '"' | sort)"
[[ -n "$expected" ]] || die "could not read MIGRATION_ORDER from apps/api/src/jobs/migrateStandalone.ts"
applied="$(psql -At "$drill_url" -c "select name from mimt_schema_migrations order by name" 2>/dev/null | sort)" || die "mimt_schema_migrations is missing"
missing="$(comm -23 <(printf '%s\n' "$expected") <(printf '%s\n' "$applied"))"
if [[ -n "$missing" ]]; then
  # A backup taken before the newest deploy legitimately lacks the newest migrations; anything older is a failure.
  newest="$(printf '%s\n' "$expected" | tail -n 3)"
  old_missing="$(comm -23 <(printf '%s\n' "$missing") <(printf '%s\n' "$newest"))"
  [[ -z "$old_missing" ]] || die "migrations missing from the backup: $(echo $old_missing)"
  echo "::warning::backup predates the newest migrations: $(echo $missing)"
fi
for t in users telecom_accounts phone_numbers messages; do
  n="$(psql -At "$drill_url" -c "select count(*) from $t")" || die "table $t is missing or unreadable"
  echo "rows in $t: $n"
done
echo "migrations recorded: $(printf '%s\n' "$applied" | grep -c .)"

dropdb --maintenance-db="$admin_url" "$db"
echo "restore drill OK"
