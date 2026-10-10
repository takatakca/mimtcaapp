#!/usr/bin/env bash
# Applies supabase/migrations/*.sql in order (byte order of the file names, LC_ALL=C), each file in its
# own transaction, and records what was applied so a second run only applies new files.
#
#   scripts/db/apply-migrations.sh "$DATABASE_URL"                    # Supabase (real project)
#   scripts/db/apply-migrations.sh --supabase-stubs "$TEST_DATABASE_URL"  # throwaway Postgres (CI, local tests)
#
# --supabase-stubs creates what Supabase provides and plain Postgres lacks (roles anon / authenticated /
# service_role, schema auth, auth.uid()). Never use it against a real Supabase project.
# The URL is read from the argument or from DATABASE_URL; it is never printed.
# Needs psql (PostgreSQL client 14+).
set -euo pipefail

stubs=0
if [[ "${1:-}" == "--supabase-stubs" ]]; then
  stubs=1
  shift
fi
url="${1:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "usage: $0 [--supabase-stubs] <postgres-url>   (or set DATABASE_URL)" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dir="$root/supabase/migrations"
psql_q=(psql "$url" -X -q -v ON_ERROR_STOP=1)

if ((stubs)); then
  "${psql_q[@]}" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
set client_min_messages = warning;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
SQL
  echo "supabase stubs: ok"
fi

# Bookkeeping lives outside the public schema (not exposed by the Supabase REST API).
"${psql_q[@]}" <<'SQL'
set client_min_messages = warning;
create schema if not exists mimt_meta;
create table if not exists mimt_meta.applied_migrations (
  filename   text primary key,
  sha256     text not null,
  applied_at timestamptz not null default now()
);
SQL

shopt -s nullglob
files=("$dir"/*.sql)
if ((${#files[@]} == 0)); then
  echo "no migrations in $dir" >&2
  exit 1
fi
mapfile -t files < <(printf '%s\n' "${files[@]}" | LC_ALL=C sort)

applied=0
skipped=0
for f in "${files[@]}"; do
  name="$(basename "$f")"
  if [[ ! "$name" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "ERROR: unexpected migration file name: $name" >&2
    exit 1
  fi
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  prev="$("${psql_q[@]}" -At -v name="$name" <<'SQL'
select sha256 from mimt_meta.applied_migrations where filename = :'name';
SQL
)"
  if [[ -n "$prev" ]]; then
    if [[ "$prev" != "$sum" ]]; then
      echo "ERROR: $name was already applied but its content changed. Write a new migration instead." >&2
      exit 1
    fi
    skipped=$((skipped + 1))
    continue
  fi
  echo "applying $name"
  # One transaction per file: the migration and its bookkeeping row commit together or not at all.
  {
    cat "$f"
    printf '\n;\ninsert into mimt_meta.applied_migrations (filename, sha256) values (%s, %s);\n' "'$name'" "'$sum'"
  } | "${psql_q[@]}" --single-transaction -f -
  applied=$((applied + 1))
done

echo "migrations: $applied applied, $skipped already present (${#files[@]} files)"
