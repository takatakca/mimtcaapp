#!/usr/bin/env bash
# Produce an encrypted, off-host PostgreSQL archive for the isolated MIMT database.
# This script ONLY backs up: no migrations, no database writes, no production restores.
# Schedule it in an environment with private network access to MIMT PostgreSQL.
set -Eeuo pipefail
umask 077

die() { printf 'MIMT backup error: %s\n' "$*" >&2; exit 1; }
require_env() { [[ -n "${!1:-}" ]] || die "missing required variable $1"; }
for name in PGHOST PGUSER PGDATABASE MIMT_BACKUP_AGE_RECIPIENT MIMT_BACKUP_S3_BUCKET; do
  require_env "$name"
done

# Explicit fail-closed target verification protects the TAKATAK master database.
[[ "$PGDATABASE" == "mimt_production" ]] || die "refusing to back up a database other than mimt_production"
[[ "$PGUSER" == "mimt_owner" ]] || die "refusing to use an unexpected PostgreSQL role"
[[ ! "${PGHOST,,}" =~ supabase[.] ]] || die "refusing a Supabase host"
[[ "$PGHOST" != *"://"* ]] || die "PGHOST must be a private hostname or socket path, not a URL"
[[ "$MIMT_BACKUP_AGE_RECIPIENT" =~ ^age1[a-z0-9]{20,}$ ]] || die "MIMT_BACKUP_AGE_RECIPIENT must be a public age recipient"
[[ "$MIMT_BACKUP_S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "invalid backup bucket name"
prefix="${MIMT_BACKUP_S3_PREFIX:-mimt/postgres}"
[[ "$prefix" =~ ^[A-Za-z0-9_/-]+$ && "$prefix" != *..* ]] || die "invalid backup prefix"

# Credentials remain in PG* / AWS* environment variables, never in process arguments.
# For network access set PGSSLMODE=verify-full with the authentic CA and matching host.
for cmd in pg_dump age aws date mktemp wc; do
  command -v "$cmd" >/dev/null 2>&1 || die "required executable unavailable: $cmd"
done

workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$workdir/mimt.dump.age"
key="${prefix%/}/mimt_production-${timestamp}-${RANDOM}.dump.age"

# pg_dump -Fc is compressed and suitable for pg_restore; no plaintext file is written.
pg_dump --format=custom --no-owner --no-acl |
  age -r "$MIMT_BACKUP_AGE_RECIPIENT" -o "$backup"

[[ -s "$backup" ]] || die "encrypted archive missing or empty"
local_bytes="$(wc -c < "$backup" | tr -d ' ')"
aws s3 cp "$backup" "s3://${MIMT_BACKUP_S3_BUCKET}/${key}" --sse AES256 --only-show-errors

# Head-object confirms an encrypted object exists off-host with the expected size;
# it is NOT a substitute for periodic restore tests.
remote_bytes="$(aws s3api head-object --bucket "$MIMT_BACKUP_S3_BUCKET" --key "$key" --query ContentLength --output text)"
[[ "$remote_bytes" =~ ^[0-9]+$ && "$remote_bytes" -eq "$local_bytes" ]] ||
  die "off-host object verification failed"

printf 'MIMT encrypted off-host backup verified (uploaded bytes: %s).\n' "$remote_bytes"
printf 'Object: s3://%s/%s\n' "$MIMT_BACKUP_S3_BUCKET" "$key"
printf 'REMINDER: perform and record a real restore test to an isolated disposable PostgreSQL instance.\n'
