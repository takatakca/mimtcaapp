import { describe, expect, it } from "vitest";
import { adFreeFor, ADDON_STORE_PRODUCTS, isSubscriptionAddOn, storeAddOnProduct, SUBSCRIPTION_ADD_ONS } from "./addons.js";
import { ADD_ONS, PLANS, STORE_PRODUCTS } from "./plans.js";
import { FREE_PLAN_INTL_LIMITS, INTL_RATES, intlRateFor } from "./rates.js";

describe("Sans pub add-on", () => {
  it("costs 3,99 $/mo or 29,99 $/yr and grants no_ads", () => {
    expect(SUBSCRIPTION_ADD_ONS.no_ads).toMatchObject({ monthlyPriceCents: 399, yearlyPriceCents: 2999, features: ["no_ads"] });
    expect(SUBSCRIPTION_ADD_ONS.no_ads.name.fr).toBe("Sans pub");
    expect(isSubscriptionAddOn("no_ads")).toBe(true);
    expect(isSubscriptionAddOn("extra_number")).toBe(false);
  });

  it("does not change the owner's plan prices or the free cap", () => {
    expect(PLANS.free.caps.outboundMinutes).toBe(30);
    expect(PLANS.premium.monthlyPriceCents).toBe(1999);
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
