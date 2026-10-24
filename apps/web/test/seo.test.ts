// Unit tests for the SEO / AI-discoverability data (node --test, TypeScript run by Node's type stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLANS, formatCad, type PlanCode } from "@mimt/shared";
import { faqItems } from "../lib/faq.ts";
import { llmsTxt } from "../lib/llms.ts";
import { PAGE_META } from "../lib/meta.ts";
import { faqPageLd, graph, jsonLdString, planOfferLd, serviceLd } from "../lib/seo.ts";
import { ROUTES, SITE_URL, type RouteKey } from "../lib/site.ts";

const KEYS = Object.keys(ROUTES) as RouteKey[];
const CODES = Object.keys(PLANS) as PlanCode[];

test("every page has a French and English title and description of search-friendly length", () => {
  for (const key of KEYS) {
    for (const lang of ["fr", "en"] as const) {
      const m = PAGE_META[key][lang];
      assert.ok(m.title.length > 3 && m.title.length <= 60, `${key}/${lang} title length ${m.title.length}`);
      assert.ok(m.description.length >= 50 && m.description.length <= 170, `${key}/${lang} description length ${m.description.length}`);
    }
  }
});

test("routes are unique, French at the root and English under /en/", () => {
  const all = KEYS.flatMap((k) => [ROUTES[k].fr, ROUTES[k].en]);
  assert.equal(new Set(all).size, all.length);
  for (const k of KEYS) {
    assert.ok(ROUTES[k].fr.endsWith("/") && ROUTES[k].en.endsWith("/"));
    assert.ok(!ROUTES[k].fr.startsWith("/en/"));
    assert.ok(ROUTES[k].en.startsWith("/en/"));
  }
});

test("JSON-LD offers use the shared plan prices, in CAD", () => {
  for (const code of CODES) {
    const offer = planOfferLd(code, "fr");
    assert.equal(offer.price, (PLANS[code].monthlyPriceCents / 100).toFixed(2));
    assert.equal(offer.priceCurrency, "CAD");
  }
  const mobile = serviceLd("en", "mobile") as { hasOfferCatalog: { itemListElement: unknown[] } };
  assert.equal(mobile.hasOfferCatalog.itemListElement.length, 3);
  const business = serviceLd("fr", "business") as { hasOfferCatalog: { itemListElement: unknown[] } };
  assert.equal(business.hasOfferCatalog.itemListElement.length, 2);
});

test("JSON-LD output cannot close its script tag", () => {
  const s = jsonLdString(graph([{ "@type": "Thing", name: "</script><b>" }]));
  assert.ok(!s.includes("<"));
  assert.deepEqual(JSON.parse(s)["@graph"][0].name, "</script><b>");
});

test("FAQ: same questions in French and English, plain-text answers, valid FAQPage", () => {
  const fr = faqItems("fr");
  const en = faqItems("en");
  assert.deepEqual(
    fr.map((i) => i.id),
    en.map((i) => i.id),
  );
  for (const i of [...fr, ...en]) {
    assert.ok(i.q.endsWith("?") || i.q.endsWith("."), i.q);
    assert.ok(!/[<>]/.test(i.a), i.id);
    if (i.link) assert.ok(i.link.route in ROUTES);
  }
  const ld = faqPageLd("fr", fr) as { mainEntity: unknown[] };
  assert.equal(ld.mainEntity.length, fr.length);
});

test("FAQ prices come from the shared plans", () => {
  const a = faqItems("fr").find((i) => i.id === "affaires-prix")!.a;
  assert.ok(a.includes(formatCad(PLANS.business.monthlyPriceCents, "fr")));
  assert.ok(a.includes(formatCad(PLANS.business_pro.monthlyPriceCents, "fr")));
});

test("llms.txt summarises MIMT with real prices and links to every page", () => {
  const txt = llmsTxt();
  assert.ok(txt.startsWith("# MIMT\n\n> "));
  for (const code of CODES) {
    const cents = PLANS[code].monthlyPriceCents;
    if (cents > 0) assert.ok(txt.includes(`CAD ${(cents / 100).toFixed(2)}`), code);
  }
  for (const k of KEYS) assert.ok(txt.includes(SITE_URL + ROUTES[k].fr), k);
  assert.match(txt, /9-1-1/);
  assert.match(txt, /consent/);
  assert.match(txt, /Status: open/);
  assert.match(txt, /store apps are not released yet/);
});
