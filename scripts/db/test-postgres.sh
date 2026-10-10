#!/usr/bin/env bash
# Runs the API test suite against a real, throwaway Postgres: applies every migration (with the Supabase
# stubs), then runs vitest with TEST_DATABASE_URL so the Postgres repository contract tests run instead of
# being skipped. Fails if any test is skipped.
#
#   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/mimt_test scripts/db/test-postgres.sh
#
# The database must be disposable: the contract tests truncate its tables.
# Needs: psql, and `pnpm install` + `pnpm --filter @mimt/shared build` already done.
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is required (a throwaway database; its tables are truncated)" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"$root/scripts/db/apply-migrations.sh" --supabase-stubs "$TEST_DATABASE_URL"

report="$(mktemp -t mimt-vitest-XXXXXX.json)"
trap 'rm -f "$report"' EXIT

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
