import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, LAUNCH_LINEUP, planEconomics, usageQuota } from "./unitEconomics.js";

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
