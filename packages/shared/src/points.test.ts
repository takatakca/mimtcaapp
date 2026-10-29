import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, DEFAULT_CARRIER_RATES_USD } from "./unitEconomics.js";
import { MISSION_POINTS_CAP, MISSIONS } from "./missions.js";
import {
  MAX_CAMPAIGN_MULTIPLIER,
  MAX_REWARD_COST_SHARE,
  MISSION_POINTS_PER_MINUTE,
  POINTS_CATALOG,
  POINTS_PER_DOLLAR,
  REFERRAL_POINTS,
  campaignMatches,
  pointsCatalogViolations,
  pointsForCents,
  rewardEconomics,
  type PointsReward,
} from "./points.js";

// The rule (owner, 2026-10-28; docs/MIMT-UNIT-ECONOMICS.md « Points »): what points buy costs MIMT, at worst, at most
// 10 % of the revenue that earned those points, even at the highest campaign multiplier.
describe("MIMT Points economics", () => {
  it("the whole default catalog passes the rule", () => {
    expect(pointsCatalogViolations(POINTS_CATALOG)).toEqual([]);
  });

  it("fixes each reward's worst-case numbers (a carrier price or a points price change must be reviewed)", () => {
    const table = Object.fromEntries(POINTS_CATALOG.map((r) => [r.id, rewardEconomics(r)]));
    expect(table.minutes_out_30).toMatchObject({ costCad: 0.756, shareAtBaseRate: 0.0252, shareAtMaxCampaign: 0.0756, pointsPerMinute: 10, ok: true });
    expect(table.minutes_out_100).toMatchObject({ costCad: 2.52, shareAtBaseRate: 0.0252, ok: true });
    expect(table.minutes_on_net_60).toMatchObject({ costCad: 0.336, shareAtBaseRate: 0.0224, shareAtMaxCampaign: 0.0672, ok: true });
    expect(table.texts_50).toMatchObject({ costCad: 0.581, shareAtBaseRate: 0.0232, shareAtMaxCampaign: 0.0697, ok: true });
    expect(table.ad_free_week).toMatchObject({ costCad: 0.5, shareAtBaseRate: 0.025, ok: true });
    expect(table.invoice_credit_5).toMatchObject({ costCad: 5, shareAtBaseRate: 0.025, shareAtMaxCampaign: 0.075, ok: true });
    for (const e of Object.values(table)) expect(e.shareAtMaxCampaign).toBeLessThanOrEqual(MAX_REWARD_COST_SHARE);
  });

  it("fails a reward priced too low", () => {
    const cheap: PointsReward = { ...POINTS_CATALOG[0]!, points: 50 };
    expect(pointsCatalogViolations([cheap]).map((v) => v.id)).toEqual(["minutes_out_30"]);
    const credit: PointsReward = { ...POINTS_CATALOG.find((r) => r.id === "invoice_credit_5")!, points: 1000 };
    expect(pointsCatalogViolations([credit])).toHaveLength(1);
    // A disabled reward is not sold, so it is not checked.
    expect(pointsCatalogViolations([{ ...cheap, enabled: false }])).toEqual([]);
  });

  it("minutes are never cheaper than the missions' 10 points per minute", () => {
    const tooCheap: PointsReward = { ...POINTS_CATALOG[0]!, points: 290 };
    expect(rewardEconomics(tooCheap).ok).toBe(false);
  });

  it("a carrier price hike is caught", () => {
    const rates = { ...DEFAULT_CARRIER_RATES_USD, pstnOutPerMin: 0.05 };
    expect(pointsCatalogViolations(POINTS_CATALOG, rates, DEFAULT_ASSUMPTIONS).map((v) => v.id)).toEqual(["minutes_out_30", "minutes_out_100"]);
  });

  it("missions are worth 1 500 points (the old 150 minutes at 10 points per minute)", () => {
    expect(MISSION_POINTS_CAP).toBe(1500);
    expect(MISSION_POINTS_CAP / MISSION_POINTS_PER_MINUTE).toBe(150);
    expect(MISSIONS.filter((m) => m.rewardKind === "points").every((m) => m.points % MISSION_POINTS_PER_MINUTE === 0)).toBe(true);
  });

  it("earn rates", () => {
    expect(POINTS_PER_DOLLAR).toBe(10);
    expect(REFERRAL_POINTS).toBe(1000);
    expect(MAX_CAMPAIGN_MULTIPLIER).toBe(3);
    expect(pointsForCents(1299)).toBe(129);
    expect(pointsForCents(14289)).toBe(1428);
    expect(pointsForCents(-5)).toBe(0);
  });

  it("campaign targets", () => {
    expect(campaignMatches("purchase", { reason: "purchase", action: "invoice", interval: "month" })).toBe(true);
    expect(campaignMatches("purchase_yearly", { reason: "purchase", action: "invoice", interval: "month" })).toBe(false);
    expect(campaignMatches("purchase_yearly", { reason: "purchase", action: "store", interval: "year" })).toBe(true);
    expect(campaignMatches("mission:first_number", { reason: "mission", action: "first_number" })).toBe(true);
    expect(campaignMatches("mission:first_number", { reason: "mission", action: "choose_handle" })).toBe(false);
    expect(campaignMatches("mission", { reason: "referral", action: "referral" })).toBe(false);
    expect(campaignMatches("referral", { reason: "referral", action: "referral" })).toBe(true);
  });

  it("no reward pays for a review, a rating, a like, a follow or a social share, and none is a draw", () => {
    const text = POINTS_CATALOG.map((r) => `${r.id} ${r.label.fr} ${r.label.en} ${r.description.fr} ${r.description.en}`).join(" ").toLowerCase();
    for (const word of ["avis", "review", "rating", "étoile", "j'aime", "like", "follow", "partage", "share", "tirage", "draw", "concours", "contest", "argent comptant", "cash"]) {
      expect(text, word).not.toContain(word);
    }
  });
});
