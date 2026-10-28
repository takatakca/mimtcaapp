// /affilies/: commission figures come from @mimt/shared, the form posts to the API with the Law 25 / CASL / 18+ boxes,
// and the ?aff= link capture keeps the first touch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AFFILIATE_DEFAULTS, formatCommissionPct } from "@mimt/shared";
import { AFFILIATE_STORAGE_KEY, captureAffiliateTouch, readAffiliateTouch, withAffiliateParam } from "../lib/affiliate-link.ts";
import { llmsTxt } from "../lib/llms.ts";
import { PAGE_META } from "../lib/meta.ts";
import { ROUTES, SITE_URL } from "../lib/site.ts";

const web = fileURLToPath(new URL("..", import.meta.url));

test("/affilies/ and /en/affiliates/ exist, and their meta states the shared default terms", () => {
  assert.equal(ROUTES.affiliates.fr, "/affilies/");
  assert.equal(ROUTES.affiliates.en, "/en/affiliates/");
  const pct = formatCommissionPct(AFFILIATE_DEFAULTS.commissionBps);
  assert.ok(PAGE_META.affiliates.fr.description.includes(`${pct} %`));
  assert.ok(PAGE_META.affiliates.en.description.includes(`${pct}%`));
  for (const lang of ["fr", "en"] as const) assert.ok(PAGE_META.affiliates[lang].description.includes(`${AFFILIATE_DEFAULTS.durationMonths}`));
  assert.ok(llmsTxt().includes(SITE_URL + ROUTES.affiliates.fr));
  assert.ok(llmsTxt().includes(`${pct}%`));
});

test("the application form posts to the API with the honeypot, a required privacy notice and 18+, and an optional CASL box", () => {
  const form = readFileSync(join(web, "components", "AffiliateForm.tsx"), "utf8");
  assert.match(form, /\/v1\/public\/affiliates\/applications/);
  assert.match(form, /name="website"/);
  assert.match(form, /id=\{id\("privacy"\)\} name="privacy" type="checkbox" required/);
  assert.match(form, /id=\{id\("adult"\)\} name="adult" type="checkbox" required/);
  assert.match(form, /id=\{id\("marketing"\)\} name="marketing" type="checkbox" defaultChecked=\{false\}/);
  assert.match(form, /Avis de confidentialité \(Loi 25\)/);
  const page = readFileSync(join(web, "components", "pages", "AffiliatesPage.tsx"), "utf8");
  assert.match(page, /Lien affilié : je reçois une commission/);
  assert.match(page, /Loi canadienne anti-pourriel/);
  assert.match(page, /AFFILIATE_DEFAULTS/);
});

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("affiliate link capture: first touch for 60 days, then a new link counts", () => {
  const s = memory();
  const t0 = new Date("2026-11-01T12:00:00Z");
  assert.deepEqual(captureAffiliateTouch("?aff=abcd2345", () => s, t0), { code: "ABCD2345", touchedAt: t0.toISOString() });
  assert.equal(captureAffiliateTouch("?aff=ZZZZ9999", () => s, new Date(t0.getTime() + 86_400_000))!.code, "ABCD2345");
  const later = new Date(t0.getTime() + 61 * 86_400_000);
  assert.equal(readAffiliateTouch(() => s, later), null);
  assert.equal(captureAffiliateTouch("?aff=ZZZZ9999", () => s, later)!.code, "ZZZZ9999");
  assert.ok(s.data.has(AFFILIATE_STORAGE_KEY));
  assert.equal(captureAffiliateTouch("?aff=<b>", () => memory()), null);
  assert.equal(
    captureAffiliateTouch("?aff=ABCD2345", () => {
      throw new Error("blocked");
    }),
    null,
  );
});

test("app links carry the code in the query and keep the hold in the fragment", () => {
  const touch = { code: "ABCD2345", touchedAt: "2026-11-01T12:00:00.000Z" };
  assert.equal(withAffiliateParam("https://app.mimt.ca/numero#hold=abc&t=tok&plan=lock", touch), "https://app.mimt.ca/numero?aff=ABCD2345#hold=abc&t=tok&plan=lock");
  assert.equal(withAffiliateParam("https://app.mimt.ca/?aff=OTHER234", touch), "https://app.mimt.ca/?aff=OTHER234");
  assert.equal(withAffiliateParam("https://app.mimt.ca/", null), "https://app.mimt.ca/");
});
