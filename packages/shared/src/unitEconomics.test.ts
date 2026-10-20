import { describe, expect, it } from "vitest";
import { ADD_ONS, PLANS, TRIAL_CAPS } from "./plans.js";
import { DEFAULT_ASSUMPTIONS, LAUNCH_LINEUP, planEconomics, planRuleViolations, quotaFromCaps, usageQuota } from "./unitEconomics.js";

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
