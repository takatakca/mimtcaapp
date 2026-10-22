// Redesign rules: download prompt once per visitor, prices from PLANS, honest JSON-LD, OG cards present.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PLANS, formatCad, type PlanCode } from "@mimt/shared";
import {
  DESKTOP_DELAY_MS,
  PROMPT_STORAGE_KEY,
  alreadyPrompted,
  isExitIntent,
  markPrompted,
  promptModeFor,
  scrolledEnough,
  type KeyValueStore,
} from "../lib/download-prompt.ts";
import { heroWithoutNumber } from "../lib/hero.ts";
import { capLines, num, price, yearly } from "../lib/plans-view.ts";
import { softwareApplicationLd, faqPageLd } from "../lib/seo.ts";
import { faqItems } from "../lib/faq.ts";
import { OG_PAGES, ROUTES } from "../lib/site.ts";

const web = fileURLToPath(new URL("..", import.meta.url));

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test("download prompt: opens by itself at most once per visitor", () => {
  const s = memoryStore();
  assert.equal(alreadyPrompted(() => s), false);
  markPrompted(() => s, new Date("2026-10-16T12:00:00Z"));
  assert.equal(s.data.get(PROMPT_STORAGE_KEY), "2026-10-16T12:00:00.000Z");
  assert.equal(alreadyPrompted(() => s), true);
});

test("download prompt: blocked or missing storage never nags and never throws", () => {
  const throwing = () => {
    throw new Error("SecurityError");
  };
  assert.equal(alreadyPrompted(throwing), true);
  assert.doesNotThrow(() => markPrompted(throwing));
  const failingSet: KeyValueStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.doesNotThrow(() => markPrompted(() => failingSet));
  assert.equal(alreadyPrompted(() => null), true);
});

test("download prompt: modal only on desktop with a mouse, small sheet everywhere else", () => {
  assert.equal(promptModeFor(1440, true), "modal");
  assert.equal(promptModeFor(1440, false), "sheet"); // large touch tablet
  assert.equal(promptModeFor(390, true), "sheet");
  assert.equal(promptModeFor(390, false), "sheet");
  assert.equal(DESKTOP_DELAY_MS, 25_000);
});

test("download prompt: mobile sheet waits for half of the page, exit intent is the top edge", () => {
  // 3000 px page, 800 px viewport: 2200 px scrollable, half = 1100 px.
  assert.equal(scrolledEnough(0, 800, 3000), false);
  assert.equal(scrolledEnough(1099, 800, 3000), false);
  assert.equal(scrolledEnough(1100, 800, 3000), true);
  assert.equal(scrolledEnough(0, 800, 700), false); // nothing to scroll: never fires
  assert.equal(isExitIntent({ clientY: 0, relatedTarget: null }), true);
  assert.equal(isExitIntent({ clientY: -3, relatedTarget: null }), true);
  assert.equal(isExitIntent({ clientY: 200, relatedTarget: null }), false);
  assert.equal(isExitIntent({ clientY: 0, relatedTarget: {} }), false); // moving onto another element
});

test("plan card prices and limits come from PLANS", () => {
  for (const code of Object.keys(PLANS) as PlanCode[]) {
    const p = PLANS[code];
    for (const lang of ["fr", "en"] as const) {
      assert.equal(price(p, lang).amount, formatCad(p.monthlyPriceCents, lang), `${code}/${lang}`);
      if (p.yearlyPriceCents) assert.ok(yearly(p, lang)?.includes(formatCad(p.yearlyPriceCents, lang)));
      const lines = capLines(p, lang).join("\n");
      if (p.caps.hasNumber) {
        for (const n of [p.caps.outboundMinutes, p.caps.inboundMinutes, p.caps.messages]) assert.ok(lines.includes(num(n, lang)), `${code}/${lang}: ${n}`);
      } else {
        // Gratuit: says plainly there is no phone number, and shows the app-to-app minutes.
        assert.match(lines, lang === "fr" ? /Pas de numéro de téléphone/ : /No phone number/);
        assert.ok(lines.includes(num(p.caps.onNetMinutes ?? 0, lang)));
      }
    }
  }
});

test("SoftwareApplication JSON-LD: offers from PLANS, never a rating or review", () => {
  for (const lang of ["fr", "en"] as const) {
    const app = softwareApplicationLd(lang) as { offers: { price: string; priceCurrency: string }[] };
    assert.deepEqual(
      app.offers.map((o) => o.price),
      (["free", "lock", "premium"] as PlanCode[]).map((c) => (PLANS[c].monthlyPriceCents / 100).toFixed(2)),
    );
    assert.ok(app.offers.every((o) => o.priceCurrency === "CAD"));
    const json = JSON.stringify(app);
    assert.ok(!/aggregateRating|"review"|ratingValue/.test(json));
  }
});

test("home FAQPage JSON-LD has its own @id", () => {
  const ld = faqPageLd("fr", faqItems("fr").slice(0, 2), "home") as { "@id": string };
  assert.ok(ld["@id"].endsWith(`${ROUTES.home.fr}#faq`));
});

test("every page listed in OG_PAGES has its French and English card", () => {
  for (const key of OG_PAGES) {
    for (const lang of ["fr", "en"]) {
      const f = join(web, "public", "og", `${key}-${lang}.png`);
      assert.ok(existsSync(f), `missing public/og/${key}-${lang}.png (run scripts/og-cards.mjs)`);
      const png = readFileSync(f);
      assert.equal(png.readUInt32BE(16), 1200, `${key}-${lang} width`);
      assert.equal(png.readUInt32BE(20), 630, `${key}-${lang} height`);
    }
  }
});

/** Source text of the site without comments (comments may explain what the copy must NOT say). */
function siteSource(): { file: string; text: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ["components", "lib", "app"]) walk(join(web, d));
  return files.map((file) => ({
    file,
    text: readFileSync(file, "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  }));
}

test("home hero: free @nom texts, and the Free plan app-to-app minute cap — calls are not unlimited", () => {
  for (const lang of ["fr", "en"] as const) {
    const text = heroWithoutNumber(lang, PLANS.free.caps.onNetMinutes ?? 0);
    assert.ok(text.includes("@nom"), lang);
    assert.ok(text.includes(num(PLANS.free.caps.onNetMinutes ?? 0, lang)), lang);
    assert.equal(PLANS.free.caps.onNetMinutes, 120);
    assert.doesNotMatch(text, /illimit|unlimited/i);
  }
  assert.match(heroWithoutNumber("fr", 120), /textez gratuitement/);
  assert.match(heroWithoutNumber("fr", 120), /appelez-les entre applications/);
  assert.match(heroWithoutNumber("en", 120), /text other MIMT users for free/);
  assert.match(heroWithoutNumber("en", 120), /call them between apps/);
  const home = readFileSync(join(web, "components", "pages", "HomePage.tsx"), "utf8");
  assert.match(home, /heroWithoutNumber\(lang, PLANS\.free\.caps\.onNetMinutes/);
});

test("copy has no false urgency or invented popularity", () => {
  const banned = /plus que \d|plus que quelques|dernière chance|compte à rebours|offre se termine|places limitées|only \d+ left|last chance|countdown|hurry|le plus populaire|most popular|\bmeilleur au canada\b/i;
  for (const { file, text } of siteSource()) assert.ok(!banned.test(text), `${file}: ${text.match(banned)?.[0]}`);
});

test("competitor facts are sourced from the competitor's own site and dated", () => {
  const data = JSON.parse(readFileSync(join(web, "content", "rivals.json"), "utf8"));
  assert.match(data.checked, /^\d{4}-\d{2}-\d{2}$/);
  for (const r of data.rivals) {
    assert.ok(r.facts.length > 0, r.name);
    for (const f of r.facts) {
      assert.ok(f.fr && f.en, r.name);
      const host = new URL(f.source).hostname;
      assert.ok(host === r.domain || host.endsWith(`.${r.domain}`), `${r.name}: ${f.source}`);
    }
  }
});

test("no competitor names in the site source (named facts live only in content/rivals.json)", () => {
  for (const { file, text } of siteSource()) assert.ok(!/textnow|fongo|\bfizz\b|magicjack|ooma/i.test(text), file);
});
