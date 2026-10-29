import { describe, expect, it } from "vitest";
import { adFreeFor, ADDON_STORE_PRODUCTS, calendarEntitled, calendarIncludedIn, isSubscriptionAddOn, storeAddOnProduct, SUBSCRIPTION_ADD_ONS } from "./addons.js";
import { ADD_ONS, PLANS, STORE_PRODUCTS, YEARLY_MONTHS_PAID } from "./plans.js";
import { FREE_PLAN_INTL_LIMITS, INTL_RATES, intlRateFor } from "./rates.js";

describe("Sans pub add-on", () => {
  it("costs 3,99 $/mo or 29,99 $/yr and grants no_ads", () => {
    expect(SUBSCRIPTION_ADD_ONS.no_ads).toMatchObject({ monthlyPriceCents: 399, yearlyPriceCents: 2999, features: ["no_ads"] });
    expect(SUBSCRIPTION_ADD_ONS.no_ads.name.fr).toBe("Sans pub");
    expect(isSubscriptionAddOn("no_ads")).toBe(true);
    expect(isSubscriptionAddOn("extra_number")).toBe(false);
  });

  it("does not change the launch plan prices or the free plan (no phone-network number)", () => {
    expect(PLANS.free.caps.hasNumber).toBe(false);
    expect(PLANS.free.caps.outboundMinutes).toBe(0);
    expect(PLANS.premium.monthlyPriceCents).toBe(2999);
    expect(ADD_ONS.extra_number.monthlyPriceCents).toBe(499);
  });

  it("has store SKUs that do not collide with plan SKUs", () => {
    expect(storeAddOnProduct("ca.mimt.app.noads.yearly")).toEqual({ addon: "no_ads", interval: "year" });
    expect(storeAddOnProduct("ca.mimt.app.premium.monthly")).toBeUndefined();
    for (const id of Object.keys(ADDON_STORE_PRODUCTS)) expect(id in STORE_PRODUCTS).toBe(false);
  });

  it("turns ads off for the add-on or a no_ads plan only", () => {
    expect(adFreeFor("free")).toBe(false);
    expect(adFreeFor("lock", [])).toBe(false);
    expect(adFreeFor("free", ["no_ads"])).toBe(true);
    expect(adFreeFor("premium")).toBe(true);
    expect(adFreeFor(undefined, ["no_ads"])).toBe(true);
  });
});

describe("Google Agenda add-on", () => {
  const a = SUBSCRIPTION_ADD_ONS.google_calendar;
  it("costs 3,95 $/mo, 11 × monthly per year, with a 14-day trial", () => {
    expect(a).toMatchObject({ monthlyPriceCents: 395, yearlyPriceCents: 395 * YEARLY_MONTHS_PAID, trialDays: 14, features: ["calendar_sync"] });
    expect(a.name.fr).toBe("Google Agenda");
    expect(isSubscriptionAddOn("google_calendar")).toBe(true);
  });

  it("is included in Affaires and Affaires Pro, sold on Essentiel and Premium", () => {
    expect(a.includedIn).toEqual(["business", "business_pro"]);
    expect(a.availableOn).toEqual(["lock", "premium"]);
    for (const p of ["business", "business_pro"] as const) expect(PLANS[p].features).toContain("calendar_sync");
    for (const p of ["free", "lock", "premium"] as const) expect(PLANS[p].features).not.toContain("calendar_sync");
  });

  it("entitlement matrix: plan or live add-on", () => {
    expect(calendarIncludedIn("business")).toBe(true);
    expect(calendarIncludedIn("premium")).toBe(false);
    expect(calendarEntitled("free")).toBe(false);
    expect(calendarEntitled("lock")).toBe(false);
    expect(calendarEntitled("premium")).toBe(false);
    expect(calendarEntitled("lock", ["google_calendar"])).toBe(true);
    expect(calendarEntitled("premium", ["no_ads", "google_calendar"])).toBe(true);
    expect(calendarEntitled("premium", ["no_ads"])).toBe(false);
    expect(calendarEntitled("business")).toBe(true);
    expect(calendarEntitled("business_pro")).toBe(true);
    expect(calendarEntitled(undefined)).toBe(false);
  });

  it("has no store SKU (web-only add-on)", () => {
    expect(Object.values(ADDON_STORE_PRODUCTS).some((p) => (p.addon as string) === "google_calendar")).toBe(false);
  });
});

describe("international rates", () => {
  it("uses the longest prefix", () => {
    expect(intlRateFor("+18765551234")?.country.en).toBe("Jamaica");
    expect(intlRateFor("+33612345678")?.centsPerMinute).toBe(INTL_RATES.find((r) => r.prefix === "+33")!.centsPerMinute);
    expect(intlRateFor("+3512123456")?.prefix).toBe("+351");
    expect(intlRateFor("+999123")).toBeUndefined();
  });

  it("keeps free-plan limits below the paid ones", () => {
    expect(FREE_PLAN_INTL_LIMITS.maxTopUpCents).toBeLessThan(10_000);
    expect(FREE_PLAN_INTL_LIMITS.maxBalanceCents).toBeGreaterThanOrEqual(FREE_PLAN_INTL_LIMITS.maxTopUpCents);
  });
});
