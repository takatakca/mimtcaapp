import { describe, expect, it } from "vitest";
import { ADD_ONS, PLANS, TRIAL_CAPS, YEARLY_MONTHS_PAID } from "./plans.js";
import {
  DEFAULT_ASSUMPTIONS,
  LAUNCH_LINEUP,
  MAX_COST_SHARE_YEARLY,
  NEVER_A_LOSS,
  planEconomics,
  planRuleViolations,
  quotaFromCaps,
  usageQuota,
  yearlyPlanEconomics,
  yearlyPlanRuleViolations,
} from "./unitEconomics.js";

describe("unit economics rule: worst-case carrier cost ≤ 70 % of the price after Stripe fees", () => {
  for (const code of ["essentiel", "premium", "business", "business_pro"] as const) {
    it(`${code} passes`, () => {
      const { priceCents, quota } = LAUNCH_LINEUP[code];
      const e = planEconomics(priceCents, quota);
      expect(e.ok, `${code}: cost ${e.worstCostCad} $ vs net ${e.netCad} $ (${e.costShare})`).toBe(true);
      expect(e.costShare).toBeLessThanOrEqual(DEFAULT_ASSUMPTIONS.maxCostShare);
    });
  }

  it("free has no phone-network number and no PSTN quota", () => {
    const q = LAUNCH_LINEUP.free.quota;
    expect(q.hasNumber).toBe(false);
    expect(q.outboundMinutes + q.inboundMinutes + q.messages).toBe(0);
  });

  it("the owner's first Premium draft (250 out / 400 in) breaks the rule, which is why it was trimmed", () => {
    const draft = usageQuota({ outboundMinutes: 250, inboundMinutes: 400, messages: 400, mms: 50, transcriptionMinutes: 20 });
    expect(planEconomics(2999, draft).ok).toBe(false);
  });

  it("Stripe fee is 2.9 % + 0.30 $ and taxes are not part of the price", () => {
    expect(planEconomics(1299, LAUNCH_LINEUP.essentiel.quota).stripeFeeCad).toBe(0.68);
  });

  it("a weaker loonie is caught: at 1.60 CAD/USD Premium no longer passes", () => {
    const e = planEconomics(LAUNCH_LINEUP.premium.priceCents, LAUNCH_LINEUP.premium.quota, undefined, { ...DEFAULT_ASSUMPTIONS, usdToCad: 1.6 });
    expect(e.ok).toBe(false);
  });
});

describe("PLANS never drift from the rule", () => {
  it("every paid plan's price and caps pass", () => {
    expect(planRuleViolations(PLANS)).toEqual([]);
  });

  it("matches the launch line-up in the docs", () => {
    for (const code of ["premium", "business", "business_pro"] as const) {
      expect(quotaFromCaps(PLANS[code].caps)).toEqual(LAUNCH_LINEUP[code].quota);
      expect(PLANS[code].monthlyPriceCents).toBe(LAUNCH_LINEUP[code].priceCents);
    }
    expect(quotaFromCaps(PLANS.lock.caps)).toEqual(LAUNCH_LINEUP.essentiel.quota);
    expect(PLANS.lock.monthlyPriceCents).toBe(LAUNCH_LINEUP.essentiel.priceCents);
    expect(quotaFromCaps(PLANS.free.caps)).toEqual(LAUNCH_LINEUP.free.quota);
  });

  it("the trial quota is the line-up's", () => {
    expect(quotaFromCaps(TRIAL_CAPS)).toEqual(LAUNCH_LINEUP.trial.quota);
  });

  it("paid add-ons pass too: 250 extra minutes, extra number", () => {
    expect(planEconomics(ADD_ONS.minutes_250.priceCents, usageQuota({ hasNumber: false, outboundMinutes: 250 })).ok).toBe(true);
    expect(planEconomics(ADD_ONS.extra_number.monthlyPriceCents, usageQuota({})).ok).toBe(true);
  });
});

describe("annual plans: 12 months for the price of 11 (owner decision 2026-10-27)", () => {
  it("every paid plan has a yearly price of exactly 11 monthly prices", () => {
    for (const code of ["lock", "premium", "business", "business_pro"] as const) {
      expect(PLANS[code].yearlyPriceCents).toBe(PLANS[code].monthlyPriceCents * YEARLY_MONTHS_PAID);
    }
    expect(PLANS.free.yearlyPriceCents).toBeUndefined();
  });

  it("the yearly worst case per month uses ONE Stripe fee a year (not a straight 11/12)", () => {
    const e = yearlyPlanEconomics(PLANS.lock.yearlyPriceCents!, quotaFromCaps(PLANS.lock.caps));
    expect(e.priceCad).toBe(142.89);
    expect(e.stripeFeeCad).toBe(4.44);
    expect(e.netPerMonthCad).toBe(11.54);
    expect(e.worstCostCad).toBe(8.15);
  });

  // The margin cost of the free month, per plan (docs/MIMT-UNIT-ECONOMICS.md, « Forfaits annuels »).
  const expected = { lock: 0.706, premium: 0.754, business: 0.746, business_pro: 0.728 } as const;
  for (const [code, share] of Object.entries(expected) as [keyof typeof expected, number][]) {
    it(`${code}: yearly worst case ${share} of the net per month, under the yearly ceiling, never a loss`, () => {
      const e = yearlyPlanEconomics(PLANS[code].yearlyPriceCents!, quotaFromCaps(PLANS[code].caps));
      expect(e.costShare).toBe(share);
      expect(e.ok).toBe(true);
      expect(e.costShare).toBeLessThanOrEqual(MAX_COST_SHARE_YEARLY);
      expect(e.costShare).toBeLessThan(NEVER_A_LOSS);
    });
  }

  it("the monthly 70 % rule is NOT loosened: the yearly ceiling is a separate constant", () => {
    expect(DEFAULT_ASSUMPTIONS.maxCostShare).toBe(0.7);
    expect(MAX_COST_SHARE_YEARLY).toBe(0.8);
    expect(planRuleViolations(PLANS)).toEqual([]);
    expect(yearlyPlanRuleViolations(PLANS)).toEqual([]);
  });

  it("a yearly ceiling above 100 % is still capped at never-a-loss", () => {
    expect(yearlyPlanEconomics(PLANS.premium.yearlyPriceCents!, quotaFromCaps(PLANS.premium.caps), undefined, undefined, 5).ok).toBe(true);
    expect(yearlyPlanEconomics(10_000, quotaFromCaps(PLANS.premium.caps), undefined, undefined, 5).ok).toBe(false);
  });

  it("any plan that just passes the monthly rule stays under about 76.4 % yearly", () => {
    for (const cents of [999, 1299, 1999, 2999, 4999, 9999, 49_999]) {
      let n = 1;
      const q = (m: number) => usageQuota({ hasNumber: false, outboundMinutes: m });
      while (planEconomics(cents, q(n + 1)).ok) n++;
      expect(planEconomics(cents, q(n)).ok).toBe(true);
      expect(yearlyPlanEconomics(cents * YEARLY_MONTHS_PAID, q(n)).costShare).toBeLessThanOrEqual(0.765);
    }
  });
});
