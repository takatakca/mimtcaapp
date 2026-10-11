#!/usr/bin/env bash
# Runs the API test suite against a real, throwaway PostgreSQL so the Postgres repository contract tests
# (repo.contract, catalog.repo.contract, referrals.repo, ...) run instead of being skipped.
#
# Schema: applied with the SAME one-shot migrator used in production (apps/api/src/jobs/migrateStandalone.ts,
# bootstrap.sql + supabase/migrations in MIGRATION_ORDER). That migrator only accepts a database named
# mimt_production owned by mimt_owner, so the throwaway server must use those names:
#
#   TEST_DATABASE_URL=postgresql://mimt_owner:pw@127.0.0.1:5432/mimt_production scripts/db/test-postgres.sh
#
# The database must be DISPOSABLE: the contract tests truncate its tables. Never point this at production.
# Needs `pnpm install` and `pnpm --filter @mimt/shared build` already done. Fails if any test is skipped.
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is required (a throwaway database; its tables are truncated)" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d -t mimt-pgtest-XXXXXX)"
trap 'rm -rf "$work"' EXIT

pnpm --dir "$root" --filter @mimt/api build >/dev/null

# Same layout as the Docker image (/app/db/bootstrap.sql, /app/db/migrations/*.sql).
mkdir -p "$work/db/migrations"
cp "$root/deploy/coolify/mimt-postgres-bootstrap.sql" "$work/db/bootstrap.sql"
cp "$root"/supabase/migrations/*.sql "$work/db/migrations/"
(cd "$work" && DATABASE_URL="$TEST_DATABASE_URL" MIMT_STANDALONE_MIGRATE_CONFIRM=YES_MY_PRIVATE_MIMT_DATABASE NODE_ENV=test \
  node "$root/apps/api/dist/jobs/migrateStandalone.js")

report="$work/vitest.json"
# One file at a time: the contract test files truncate shared tables.
(cd "$root/apps/api" && pnpm exec vitest run --no-file-parallelism --reporter=default --reporter=json --outputFile.json="$report")

node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const skipped = r.numPendingTests + r.numTodoTests;
console.log(`postgres run: ${r.numPassedTests} passed, ${r.numFailedTests} failed, ${skipped} skipped`);
if (skipped > 0) {
  for (const f of r.testResults) for (const t of f.assertionResults)
    if (t.status === "pending" || t.status === "skipped" || t.status === "todo") console.error(`skipped: ${t.fullName}`);
  console.error("Tests were skipped with TEST_DATABASE_URL set. Every Postgres test must run here.");
  process.exit(1);
}
' "$report"
