#!/usr/bin/env bash
# Hermetic tests: mocked pg_dump, age and aws. No real credentials, DB or S3 calls.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
mkdir -p "$workdir/bin"

cat > "$workdir/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$PGDATABASE" == "mimt_production" && "$PGUSER" == "mimt_owner" ]]
printf 'PG-DUMP-ARCHIVE'
MOCK
cat > "$workdir/bin/age" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
while (($#)); do
  case "$1" in
    -r) shift 2 ;;
    -o) output="$2"; shift 2 ;;
    *) exit 10 ;;
  esac
done
[[ -n "$output" ]]
printf 'AGE-ENCRYPTED-' > "$output"
cat >> "$output"
MOCK
cat > "$workdir/bin/aws" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == s3 && "${2:-}" == cp ]]; then
  cp "$3" "$TEST_BACKUP_DEST"
elif [[ "${1:-}" == s3api && "${2:-}" == head-object ]]; then
  wc -c < "$TEST_BACKUP_DEST" | tr -d ' '
else
  exit 11
fi
MOCK
chmod +x "$workdir/bin/"*
export PATH="$workdir/bin:$PATH"
export PGHOST=mimt-prod-postgres.internal
export PGDATABASE=mimt_production
export PGUSER=mimt_owner
export PGSSLMODE=verify-full
export MIMT_BACKUP_AGE_RECIPIENT="age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
export MIMT_BACKUP_S3_BUCKET="mimt-private-backups"
export TEST_BACKUP_DEST="$workdir/offsite.age"

bash "$ROOT/scripts/db/backup-mimt.sh" > "$workdir/result.txt"
grep -Fq 'encrypted off-host backup verified' "$workdir/result.txt"
grep -Fq 'AGE-ENCRYPTED-PG-DUMP-ARCHIVE' "$TEST_BACKUP_DEST"

# A wrong DB must fail before the mocked pg_dump/S3 tools are called.
rm -f "$TEST_BACKUP_DEST"
if PGDATABASE=takatak_master bash "$ROOT/scripts/db/backup-mimt.sh" >/dev/null 2>&1; then
  echo 'FAIL: incorrect database accepted' >&2
  exit 1
fi
[[ ! -e "$TEST_BACKUP_DEST" ]]
if PGHOST=foo.supabase.co bash "$ROOT/scripts/db/backup-mimt.sh" >/dev/null 2>&1; then
  echo 'FAIL: Supabase host accepted' >&2
  exit 1
fi
[[ ! -e "$TEST_BACKUP_DEST" ]]
if MIMT_BACKUP_AGE_RECIPIENT=not-a-public-recipient bash "$ROOT/scripts/db/backup-mimt.sh" >/dev/null 2>&1; then
  echo 'FAIL: malformed encryption recipient accepted' >&2
  exit 1
fi
[[ ! -e "$TEST_BACKUP_DEST" ]]
if PGSSLMODE=prefer bash "$ROOT/scripts/db/backup-mimt.sh" >/dev/null 2>&1; then
  echo 'FAIL: insecure PostgreSQL TLS mode accepted' >&2
  exit 1
fi
[[ ! -e "$TEST_BACKUP_DEST" ]]
if AWS_ENDPOINT_URL=http://untrusted.local bash "$ROOT/scripts/db/backup-mimt.sh" >/dev/null 2>&1; then
  echo 'FAIL: insecure S3 endpoint accepted' >&2
  exit 1
fi
[[ ! -e "$TEST_BACKUP_DEST" ]]
echo 'PASS: MIMT encrypted backup stream, off-host metadata verification and fail-closed guards'
