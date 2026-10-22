// Local and use-case landing pages (lib/landing.ts): fr + en routes, unique titles, FAQ JSON-LD, honest facts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CANADIAN_AREA_CODES, PLANS, formatCad } from "@mimt/shared";
import { CITY_PAGES, LANDING_PAGES, cityAreaCodes, landingCopy } from "../lib/landing.ts";
import { PAGE_META } from "../lib/meta.ts";
import { faqPageLd, landingServiceLd } from "../lib/seo.ts";
import { ROUTES, type RouteKey } from "../lib/site.ts";

test("every landing page has a French and an English route", () => {
  for (const key of LANDING_PAGES) {
    assert.match(ROUTES[key].fr, /^\/[a-z0-9-]+\/$/, key);
    assert.match(ROUTES[key].en, /^\/en\/[a-z0-9-]+\/$/, key);
  }
});

test("titles and descriptions are unique across the whole site", () => {
  for (const lang of ["fr", "en"] as const) {
    const titles = (Object.keys(PAGE_META) as RouteKey[]).map((k) => PAGE_META[k][lang].title);
    const descs = (Object.keys(PAGE_META) as RouteKey[]).map((k) => PAGE_META[k][lang].description);
    assert.equal(new Set(titles).size, titles.length, `duplicate ${lang} title`);
    assert.equal(new Set(descs).size, descs.length, `duplicate ${lang} description`);
  }
});

test("each landing page has an FAQ with FAQPage JSON-LD and a Service with offers", () => {
  for (const key of LANDING_PAGES) {
    for (const lang of ["fr", "en"] as const) {
      const c = landingCopy(key, lang);
      assert.ok(c.faq.length >= 3, key);
      const faq = faqPageLd(lang, c.faq, key);
      assert.equal(faq["@type"], "FAQPage");
      assert.equal((faq.mainEntity as unknown[]).length, c.faq.length);
      const svc = landingServiceLd(lang, key, { name: c.h1, description: PAGE_META[key][lang].description, business: key === "useVoip" });
      assert.ok((svc.offers as unknown[]).length >= 2);
    }
  }
});

test("city pages use real Canadian area codes and prices from PLANS", () => {
  for (const key of CITY_PAGES) {
    for (const code of cityAreaCodes(key)) assert.ok(CANADIAN_AREA_CODES[code], `${key} ${code}`);
    const fr = landingCopy(key, "fr");
    assert.ok(fr.lead.includes(formatCad(PLANS.lock.monthlyPriceCents, "fr")), key);
    assert.ok(fr.h1.includes(cityAreaCodes(key)[0]!), key);
  }
});

test("city pages target their city with Service.areaServed, never an invented address or rating", () => {
  const svc = landingServiceLd("fr", "cityLaval", { name: "x", description: "y", business: false, city: "Laval" });
  assert.deepEqual(svc.areaServed, { "@type": "City", name: "Laval" });
  assert.ok(!/LocalBusiness|streetAddress|openingHours|aggregateRating|review/.test(JSON.stringify(svc)));
});

test("no competitor names and no fake urgency on landing pages", () => {
  for (const key of LANDING_PAGES) {
    for (const lang of ["fr", "en"] as const) {
      const text = JSON.stringify(landingCopy(key, lang));
      assert.ok(!/textnow|fongo|\bfizz\b|magicjack|ooma/i.test(text), key);
      assert.ok(!/dernière chance|plus que \d|last chance|hurry|only \d+ left|most popular/i.test(text), key);
    }
  }
});
