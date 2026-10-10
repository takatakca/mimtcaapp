import { describe, expect, it } from "vitest";
import {
  applyChargeCaps,
  computeCancellation,
  CONSUMER_CODE_RULES,
  generateContractSummary,
  renderSummaryText,
  usageNoticeText,
  usageThresholdsToNotify,
  wholeMonthsBetween,
} from "./consumerCodes.js";

// fr-CA money uses no-break spaces ("45,00 $").
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const text = (doc: Parameters<typeof renderSummaryText>[0]) => sp(renderSummaryText(doc));

const base = {
  name: { fr: "Mobile 20", en: "Mobile 20" },
  description: { fr: "Forfait mobile", en: "Mobile plan" },
  setupFeeCents: 0,
  discountCents: 0,
};
const mobile: Parameters<typeof generateContractSummary>[0] = {
  ...base,
  code: "mob-20",
  productLine: "mobile",
  monthlyPriceCents: 4500,
  termMonths: 24,
  discountCents: 48000,
  attributes: { dataGb: 20, minutes: null, sms: null, throttleKbps: 512 },
};
const internet: Parameters<typeof generateContractSummary>[0] = {
  ...base,
  code: "net-400",
  productLine: "internet_residential",
  name: { fr: "Internet 400", en: "Internet 400" },
  monthlyPriceCents: 6000,
  setupFeeCents: 4999,
  termMonths: 0,
  attributes: { downloadMbps: 400, uploadMbps: 50, internetDataGb: null },
};

describe("contract summary", () => {
  it("is French first with the Wireless Code items", () => {
    const s = generateContractSummary(mobile);
    expect(Object.keys(s).indexOf("fr")).toBeLessThan(Object.keys(s).indexOf("en"));
    expect(s.code).toBe("wireless");
    expect(s.fr.title).toBe("Résumé des renseignements essentiels");
    const t = text(s.fr);
    expect(t).toContain("45,00 $");
    expect(t).toContain("Engagement : 24 mois");
    expect(t).toContain("480,00 $"); // ECF = device discount
    expect(t).toContain("15 jours");
    expect(t).toContain("50,00 $"); // overage cap
    expect(t).toContain("100,00 $"); // roaming cap
    expect(t).toContain("taxe municipale 9-1-1");
    expect(t).toContain("déverrouillé");
    expect(t).toContain("CPRST");
    expect(t).toContain("Code sur les services sans fil");
    expect(text(s.en)).toContain("Critical Information Summary");
  });

  it("covers the Internet Code items", () => {
    const s = generateContractSummary(internet);
    const t = text(s.fr);
    expect(s.code).toBe("internet");
    expect(t).toContain("jusqu'à 400 Mbit/s");
    expect(t).toContain("Sans engagement");
    expect(t).toContain("49,99 $");
    expect(t).toContain("50 %, 75 %, 100 %");
    expect(t).not.toContain("Période d'essai"); // month to month: no trial needed
  });

  it("has a stable version that changes with the offer", () => {
    expect(generateContractSummary(mobile).version).toBe(generateContractSummary(mobile).version);
    expect(generateContractSummary({ ...mobile, monthlyPriceCents: 4600 }).version).not.toBe(generateContractSummary(mobile).version);
    expect(generateContractSummary(mobile).version).toMatch(/^cis-.+:mob-20:[0-9a-f]{8}$/);
  });

  it("refuses terms over 24 months", () => {
    expect(() => generateContractSummary({ ...mobile, termMonths: 36 })).toThrow();
  });

  it("explains the no-discount fee rule", () => {
    const t = text(generateContractSummary({ ...internet, termMonths: 12 }).fr);
    expect(t).toContain("le moindre de 50,00 $ ou 10 %");
    expect(t).toContain("Période d'essai");
  });
});

describe("bill shock", () => {
  it("notifies 50/75/100 % once each", () => {
    expect(usageThresholdsToNotify(400, 1000, [])).toEqual([]);
    expect(usageThresholdsToNotify(500, 1000, [])).toEqual([50]);
    expect(usageThresholdsToNotify(800, 1000, [50])).toEqual([75]);
    expect(usageThresholdsToNotify(1200, 1000, [])).toEqual([50, 75, 100]);
    expect(usageThresholdsToNotify(1200, 1000, [50, 75, 100])).toEqual([]);
    expect(usageThresholdsToNotify(99999, null, [])).toEqual([]);
  });

  it("caps overage at $50 and roaming at $100 unless consented", () => {
    expect(applyChargeCaps({ overageCents: 8000, roamingCents: 25000 })).toEqual({
      billableOverageCents: 5000,
      billableRoamingCents: 10000,
      overageCapReached: true,
      roamingCapReached: true,
    });
    expect(applyChargeCaps({ overageCents: 8000, roamingCents: 25000, overageCapConsentCents: 10000, roamingCapConsentCents: 30000 })).toMatchObject({
      billableOverageCents: 8000,
      billableRoamingCents: 25000,
      overageCapReached: false,
    });
    expect(CONSUMER_CODE_RULES.dataOverageCapCents).toBe(5000);
  });

  it("writes notices in French first", () => {
    expect(sp(usageNoticeText(75, "mobile").fr)).toBe("Vous avez utilisé 75 % de vos données mobiles ce mois-ci.");
    expect(sp(usageNoticeText(100, "mobile").fr)).toContain("plafonnés à 50,00 $");
  });
});

describe("cancellation", () => {
  const d = (s: string) => new Date(s);
  const m = { productLine: "mobile" as const, termMonths: 24, discountCents: 48000, monthlyPriceCents: 4500 };

  it("counts whole months", () => {
    expect(wholeMonthsBetween(d("2026-01-15"), d("2026-02-14"))).toBe(0);
    expect(wholeMonthsBetween(d("2026-01-15"), d("2026-02-15"))).toBe(1);
    expect(wholeMonthsBetween(d("2026-01-15"), d("2027-01-20"))).toBe(12);
  });

  it("charges nothing in the 15-day trial under half usage", () => {
    const r = computeCancellation({ ...m, activatedAt: d("2026-01-01"), cancelAt: d("2026-01-10"), usageFraction: 0.2 });
    expect(r).toMatchObject({ feeCents: 0, basis: "trial", inTrial: true });
  });

  it("loses the trial when half the allowance is used", () => {
    const r = computeCancellation({ ...m, activatedAt: d("2026-01-01"), cancelAt: d("2026-01-10"), usageFraction: 0.6 });
    expect(r).toMatchObject({ basis: "discount_declining", feeCents: 48000 });
  });

  it("extends the trial to 30 days for accessibility", () => {
    const r = computeCancellation({ ...m, activatedAt: d("2026-01-01"), cancelAt: d("2026-01-25"), accessibilityTrial: true });
    expect(r.inTrial).toBe(true);
  });

  it("reduces the discount equally each month", () => {
    const r = computeCancellation({ ...m, activatedAt: d("2026-01-01"), cancelAt: d("2026-07-01"), deviceBalanceCents: 12000 });
    expect(r).toMatchObject({ basis: "discount_declining", monthsElapsed: 6, monthsRemaining: 18, feeCents: 36000, deviceBalanceCents: 12000, totalCents: 48000 });
    expect(r.effectiveAt).toEqual(d("2026-07-01"));
    expect(sp(r.explanation.fr)).toContain("360,00 $");
  });

  it("is $0 after the term", () => {
    expect(computeCancellation({ ...m, activatedAt: d("2026-01-01"), cancelAt: d("2028-01-01") })).toMatchObject({ feeCents: 0, basis: "term_ended" });
  });

  it("caps the no-discount fee at the lesser of $50 or 10 %", () => {
    const base = { productLine: "internet_residential" as const, termMonths: 12, discountCents: 0, activatedAt: d("2026-01-01") };
    // 10 % of 6 × 60 $ = 36 $
    expect(computeCancellation({ ...base, monthlyPriceCents: 6000, cancelAt: d("2026-07-15") }).feeCents).toBe(3600);
    // 10 % of 11 × 80 $ = 88 $ → 50 $
    expect(computeCancellation({ ...base, monthlyPriceCents: 8000, cancelAt: d("2026-02-15") }).feeCents).toBe(5000);
    // Internet trial (30 days) on a term contract
    expect(computeCancellation({ ...base, monthlyPriceCents: 8000, cancelAt: d("2026-01-20") }).basis).toBe("trial");
  });

  it("is free month to month and before activation", () => {
    expect(computeCancellation({ ...m, termMonths: 0, discountCents: 0, activatedAt: d("2026-01-01"), cancelAt: d("2026-03-01") }).feeCents).toBe(0);
    expect(computeCancellation({ ...m, activatedAt: null, cancelAt: d("2026-03-01") }).feeCents).toBe(0);
  });
});
