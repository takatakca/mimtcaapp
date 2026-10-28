import { describe, expect, it } from "vitest";
import { AFFILIATE_DEFAULTS, AFFILIATE_LIMITS, affiliateCommissionCents, formatCommissionPct, normalizeAffiliateCode } from "./affiliates.js";

describe("affiliate program", () => {
  it("defaults sit inside the admin bounds", () => {
    expect(AFFILIATE_DEFAULTS).toEqual({ commissionBps: 2000, durationMonths: 12, payoutThresholdCents: 5000 });
    for (const k of ["commissionBps", "durationMonths", "payoutThresholdCents"] as const) {
      expect(AFFILIATE_DEFAULTS[k]).toBeGreaterThanOrEqual(AFFILIATE_LIMITS[k].min);
      expect(AFFILIATE_DEFAULTS[k]).toBeLessThanOrEqual(AFFILIATE_LIMITS[k].max);
    }
  });

  it("commission is a percentage of net revenue, rounded down to the cent", () => {
    expect(affiliateCommissionCents(1299, 2000)).toBe(259);
    expect(affiliateCommissionCents(2999, 1250)).toBe(374);
    expect(affiliateCommissionCents(0, 2000)).toBe(0);
    expect(affiliateCommissionCents(-50, 2000)).toBe(0);
  });

  it("formats the percentage in French and English", () => {
    expect(formatCommissionPct(2000)).toBe("20");
    expect(formatCommissionPct(1250, "fr")).toBe("12,5");
    expect(formatCommissionPct(1250, "en")).toBe("12.5");
  });

  it("normalizes codes", () => {
    expect(normalizeAffiliateCode(" ab-cd 2345 ")).toBe("ABCD2345");
    expect(normalizeAffiliateCode("x")).toBeNull();
    expect(normalizeAffiliateCode("<script>")).toBeNull();
  });
});
