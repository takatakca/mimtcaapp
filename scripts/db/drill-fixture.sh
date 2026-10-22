#!/usr/bin/env bash
# Builds a synthetic MIMT backup for testing scripts/db/restore-drill.sh: a scratch database with the bootstrap
# shim and every migration (MIGRATION_ORDER), one row of data, dumped in pg_dump custom format.
#
#   DRILL_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres scripts/db/drill-fixture.sh out.dump
#
# Local scratch servers only (same host rule as the drill). Leaves no database behind.
set -Eeuo pipefail
die() { printf 'drill fixture: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || die "usage: drill-fixture.sh <out.dump>"
[[ -n "${DRILL_DATABASE_URL:-}" ]] || die "DRILL_DATABASE_URL is required"
host="$(printf '%s' "$DRILL_DATABASE_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]*).*#\2#')"
[[ "$host" == "127.0.0.1" || "$host" == "localhost" || -z "$host" ]] || die "refusing a non-local host ($host)"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db="mimt_drill_fixture"
src_url="$(printf '%s' "$DRILL_DATABASE_URL" | sed -E "s#/[^/?]*(\?|$)#/$db\1#")"
dropdb --if-exists --maintenance-db="$DRILL_DATABASE_URL" "$db"
createdb --maintenance-db="$DRILL_DATABASE_URL" "$db"
trap 'dropdb --if-exists --maintenance-db="$DRILL_DATABASE_URL" "$db"' EXIT

psql -q -v ON_ERROR_STOP=1 "$src_url" -f "$root/deploy/coolify/mimt-postgres-bootstrap.sql"
psql -q -v ON_ERROR_STOP=1 "$src_url" -c "create table mimt_schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())"
for f in $(sed -n '/MIGRATION_ORDER = \[/,/\]/p' "$root/apps/api/src/jobs/migrateStandalone.ts" | grep -oE '[0-9]{4}_[a-z0-9_]+\.sql'); do
  psql -q -v ON_ERROR_STOP=1 "$src_url" -f "$root/supabase/migrations/$f" >/dev/null
  psql -q -v ON_ERROR_STOP=1 "$src_url" -c "insert into mimt_schema_migrations(name, sha256) values ('$f', 'fixture')"
done
psql -q -v ON_ERROR_STOP=1 "$src_url" -c "insert into users(locale, display_name) values ('fr-CA', 'Drill')"
pg_dump --format=custom --no-owner --no-acl --file="$1" "$src_url"
echo "fixture dump written: $1"
