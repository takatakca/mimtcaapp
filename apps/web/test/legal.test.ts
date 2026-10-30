// AdSense « program policies » pass (2026-10-30): no unfinished legal pages, no placeholders in the built site, and
// the retention periods in the privacy policy match what the API jobs actually do.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RETENTION, retentionRows } from "../lib/retention.ts";
import { COMPANY, LEGAL_UPDATED } from "../lib/site.ts";

const web = fileURLToPath(new URL("..", import.meta.url));
const api = join(web, "..", "api", "src");
const PLACEHOLDER = /\[À confirmer|\[To be confirmed/;

function files(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (re.test(e.name)) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

test("no built page contains « [À confirmer » or « [To be confirmed » (run after `pnpm build`)", (t) => {
  const pages = files(join(web, "out"), /\.(html|txt)$/);
  if (pages.length === 0) return t.skip("out/ not built yet; scripts/verify-out.mjs runs the same check in the build");
  for (const f of pages) assert.doesNotMatch(readFileSync(f, "utf8"), PLACEHOLDER, f);
});

test("site source has no placeholder and no « version préliminaire » wording", () => {
  for (const f of files(join(web, "components"), /\.tsx?$/).concat(files(join(web, "lib"), /\.tsx?$/), files(join(web, "app"), /\.tsx?$/))) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /À confirmer|To be confirmed|Version préliminaire|Preliminary version|TBC\[/, f);
  }
});

test("unknown company facts stay null until the owner gives them", () => {
  for (const [k, v] of Object.entries(COMPANY)) assert.ok(v === null || (typeof v === "string" && v.trim().length > 0), k);
  for (const lang of ["fr", "en"] as const) {
    for (const r of retentionRows(lang)) assert.doesNotMatch(r.what + r.how, /null|undefined|NaN/, r.what);
  }
});

test("privacy, terms and 9-1-1 pages show the « Dernière mise à jour » date", () => {
  assert.equal(LEGAL_UPDATED.iso, "2026-10-30");
  for (const page of ["PrivacyPage.tsx", "TermsPage.tsx", "E911Page.tsx"]) {
    const src = readFileSync(join(web, "components", "pages", page), "utf8");
    assert.match(src, /LEGAL_UPDATED\[lang\]/, page);
  }
});

test("retention periods in the privacy policy match the API code", () => {
  const num = (file: string, re: RegExp) => Number(readFileSync(join(api, file), "utf8").match(re)?.[1]);
  assert.equal(num("jobs/accountDeletion.ts", /DELETION_DELAY_DAYS = (\d+)/), RETENTION.accountPurgeDays);
  assert.equal(num("jobs/sessionRetention.ts", /SESSION_RETENTION_DAYS = (\d+)/), RETENTION.sessionDays);
  assert.equal(num("services/affiliates.ts", /REJECTED_RETENTION_DAYS = (\d+)/), RETENTION.affiliateRejectedDays);
  assert.equal(num("services/calendar.ts", /CALENDAR_JOB_RETENTION_MS = (\d+) \* 86_400_000/), RETENTION.calendarJobDays);
  assert.equal(RETENTION.quarantineDays, 90);
  assert.equal(RETENTION.accountPurgeDays, 30);
});
