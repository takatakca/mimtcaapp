// « MIMT Points » (docs/MIMT-POINTS.md): customers earn points from server-verified events (missions, a referral that
// converts, paid invoices, verified store renewals, the owner's campaigns) and exchange them for real services
// (bonus minutes, bonus texts, a week without ads, a credit on the next invoice).
//
// Every number that matters for money lives here, with the rule that keeps it safe (owner, 2026-10-28):
// the worst-case cost of what points buy stays well below what earning those points brought in. pointsCatalogViolations()
// checks it; points.test.ts fails the CI and apps/api refuses to start when a price breaks it.
//
// Legal lines (same as the missions, docs/MIMT-MISSIONS.md): no points for reviews, ratings, likes, follows or social
// shares (only a referral that converts); no draw or chance; points have no cash value, are not transferable and
// cannot be bought.

import { DEFAULT_ASSUMPTIONS, DEFAULT_CARRIER_RATES_USD, type CarrierRatesUsd, type EconomicsAssumptions } from "./unitEconomics.js";

// ------------------------------------------------------------------------------------------- earning

/** Points per dollar paid before taxes (Stripe invoices, App Store / Google Play renewals). 10 points = 1 $. */
export const POINTS_PER_DOLLAR = 10;
/** Missions: 10 points = 1 minute equivalent (the old 150-minute cap is 1 500 points). */
export const MISSION_POINTS_PER_MINUTE = 10;
/** Referrer's points when the referred friend's first paid invoice clears (on top of the Premium month for both). */
export const REFERRAL_POINTS = 1000;
/** Highest campaign multiplier an admin may set (x3 = triple points). */
export const MAX_CAMPAIGN_MULTIPLIER = 3;
/** Highest fixed campaign bonus, per account and campaign. */
export const MAX_CAMPAIGN_BONUS = 2000;

/**
 * Why points moved. Credits: mission, referral, purchase, campaign, refund. Debits: redeem, expiry, clawback (points
 * of a payment that was refunded or charged back, or points owed taken from a later credit).
 */
export type PointsReason = "mission" | "referral" | "purchase" | "campaign" | "refund" | "redeem" | "expiry" | "clawback";
/** Reasons that count toward the daily / monthly earn caps (a refund of a failed redemption does not). */
export const EARN_REASONS: readonly PointsReason[] = ["mission", "referral", "purchase", "campaign"];

/**
 * What a campaign targets. purchase: every paid invoice / store renewal; purchase_yearly: yearly plans only;
 * referral: converted referrals; mission: every mission; mission:<id>: one mission (e.g. mission:first_number).
 */
export type PointsCampaignTarget =
  | "purchase"
  | "purchase_yearly"
  | "referral"
  | "mission"
  | "mission:verify_phone"
  | "mission:choose_handle"
  | "mission:enable_push"
  | "mission:install_app"
  | "mission:first_number"
  | "mission:invite_friend"
  | "mission:go_yearly";

export const CAMPAIGN_TARGETS: readonly PointsCampaignTarget[] = [
  "purchase",
  "purchase_yearly",
  "referral",
  "mission",
  "mission:verify_phone",
  "mission:choose_handle",
  "mission:enable_push",
  "mission:install_app",
  "mission:first_number",
  "mission:invite_friend",
  "mission:go_yearly",
];

/** The server-side event a campaign is matched against. */
export interface PointsEarnEvent {
  reason: "mission" | "referral" | "purchase";
  /** mission id for missions; "invoice" or "store" for purchases; "referral". */
  action: string;
  /** Billing interval of a purchase, when known. */
  interval?: "month" | "year";
}

/** True when a campaign target applies to an earn event. */
export function campaignMatches(target: PointsCampaignTarget, e: PointsEarnEvent): boolean {
  if (target === "purchase") return e.reason === "purchase";
  if (target === "purchase_yearly") return e.reason === "purchase" && e.interval === "year";
  if (target === "referral") return e.reason === "referral";
  if (target === "mission") return e.reason === "mission";
  return e.reason === "mission" && target === `mission:${e.action}`;
}

/** Points for an amount paid before taxes, in CAD cents (rounded down: never a fraction of a point). */
export const pointsForCents = (cents: number): number => (cents > 0 ? Math.floor((cents * POINTS_PER_DOLLAR) / 100) : 0);

// ------------------------------------------------------------------------------------------- catalog

export type PointsRewardId = "minutes_out_30" | "minutes_out_100" | "minutes_on_net_60" | "texts_50" | "ad_free_week" | "invoice_credit_5";

/** How a reward is fulfilled on the server (apps/api/src/services/points.ts). */
export type PointsRewardKind = "bonus_minutes_out" | "bonus_minutes_on_net" | "bonus_messages" | "ad_free_days" | "invoice_credit";

/** Who may take a reward. paid: a live paid plan; free: the free plan; stripe_paid: a live plan billed by Stripe. */
export type PointsEligibility = "paid" | "free" | "stripe_paid" | "not_ad_free";

export interface PointsReward {
  id: PointsRewardId;
  kind: PointsRewardKind;
  /** Minutes, messages, days or CAD cents, by kind. */
  quantity: number;
  /** Price in points. */
  points: number;
  eligibility: PointsEligibility;
  /** Most redemptions of this reward per account and calendar month (UTC). */
  monthlyLimit: number;
  enabled: boolean;
  label: { fr: string; en: string };
  description: { fr: string; en: string };
}

export const POINTS_CATALOG: readonly PointsReward[] = [
  {
    id: "minutes_out_30",
    kind: "bonus_minutes_out",
    quantity: 30,
    points: 300,
    eligibility: "paid",
    monthlyLimit: 4,
    enabled: true,
    label: { fr: "30 minutes en prime", en: "30 bonus minutes" },
    description: { fr: "30 minutes d'appels sortants ajoutées au mois en cours.", en: "30 outgoing call minutes added to this month." },
  },
  {
    id: "minutes_out_100",
    kind: "bonus_minutes_out",
    quantity: 100,
    points: 1000,
    eligibility: "paid",
    monthlyLimit: 2,
    enabled: true,
    label: { fr: "100 minutes en prime", en: "100 bonus minutes" },
    description: { fr: "100 minutes d'appels sortants ajoutées au mois en cours.", en: "100 outgoing call minutes added to this month." },
  },
  {
    id: "minutes_on_net_60",
    kind: "bonus_minutes_on_net",
    quantity: 60,
    points: 150,
    eligibility: "free",
    monthlyLimit: 4,
    enabled: true,
    label: { fr: "60 minutes entre apps MIMT", en: "60 MIMT app-to-app minutes" },
    description: { fr: "60 minutes d'appels entre applications MIMT ajoutées au mois en cours.", en: "60 app-to-app call minutes added to this month." },
  },
  {
    id: "texts_50",
    kind: "bonus_messages",
    quantity: 50,
    points: 250,
    eligibility: "paid",
    monthlyLimit: 4,
    enabled: true,
    label: { fr: "50 textos en prime", en: "50 bonus texts" },
    description: { fr: "50 textos ajoutés au mois en cours (envoyés ou reçus).", en: "50 texts added to this month (sent or received)." },
  },
  {
    id: "ad_free_week",
    kind: "ad_free_days",
    quantity: 7,
    points: 200,
    eligibility: "not_ad_free",
    monthlyLimit: 4,
    enabled: true,
    label: { fr: "1 semaine sans pub", en: "1 ad-free week" },
    description: { fr: "Aucune publicité dans l'application pendant 7 jours.", en: "No ads in the app for 7 days." },
  },
  {
    id: "invoice_credit_5",
    kind: "invoice_credit",
    quantity: 500,
    points: 2000,
    eligibility: "stripe_paid",
    monthlyLimit: 1,
    enabled: true,
    label: { fr: "5 $ sur votre prochaine facture", en: "$5 off your next bill" },
    description: { fr: "Un crédit de 5 $ appliqué à votre prochaine facture MIMT (forfaits payés sur le Web).", en: "A $5 credit on your next MIMT bill (plans paid on the web)." },
  },
];

export const isPointsRewardId = (id: string): id is PointsRewardId => POINTS_CATALOG.some((r) => r.id === id);

// ------------------------------------------------------------------------------------------- economics

/**
 * Highest share of the revenue behind a point that the reward bought with it may cost, at the HIGHEST campaign
 * multiplier. 10 %: a plan priced at the 70 % rule stays at ≤ ~80 % of its net even if every point it earned is
 * spent (never a loss), and at the normal earn rate a reward costs ≤ 3.4 % of what the customer paid.
 */
export const MAX_REWARD_COST_SHARE = 0.1;

/**
 * Ad revenue MIMT gives up for one week without ads, CAD. Conservative ceiling: the free tier's worst case is
 * 0,81 $/month (docs/MIMT-UNIT-ECONOMICS.md) and AdSense/AdMob on a phone app earns well under 2 $/user/month.
 */
export const AD_REVENUE_CAD_PER_WEEK = 0.5;

/** Worst-case cost to MIMT of one redemption, CAD. */
export function rewardWorstCostCad(r: Pick<PointsReward, "kind" | "quantity">, rates: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD, a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS): number {
  const usd = (n: number) => n * a.usdToCad;
  switch (r.kind) {
    case "bonus_minutes_out":
      return usd(r.quantity * (rates.pstnOutPerMin + rates.appLegPerMin));
    case "bonus_minutes_on_net":
      return usd(r.quantity * rates.appLegPerMin);
    case "bonus_messages":
      // Bonus texts raise the SMS allowance only (MMS keep their own cap): SMS price, sent or received.
      return usd(r.quantity * rates.sms);
    case "ad_free_days":
      return (r.quantity / 7) * AD_REVENUE_CAD_PER_WEEK;
    case "invoice_credit":
      return r.quantity / 100;
  }
}

export interface RewardEconomics {
  id: PointsRewardId;
  costCad: number;
  /** Cost per point, CAD. */
  costPerPointCad: number;
  /** Revenue behind one point at the normal rate (1 $ / POINTS_PER_DOLLAR) and at the highest campaign multiplier. */
  shareAtBaseRate: number;
  shareAtMaxCampaign: number;
  /** Minutes equivalent of the price (points / MISSION_POINTS_PER_MINUTE), for minute rewards. */
  pointsPerMinute: number | null;
  ok: boolean;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function rewardEconomics(r: PointsReward, rates: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD, a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS): RewardEconomics {
  const costCad = rewardWorstCostCad(r, rates, a);
  const costPerPointCad = r.points > 0 ? costCad / r.points : Infinity;
  const revenuePerPoint = 1 / POINTS_PER_DOLLAR;
  const shareAtBaseRate = costPerPointCad / revenuePerPoint;
  const shareAtMaxCampaign = costPerPointCad / (revenuePerPoint / MAX_CAMPAIGN_MULTIPLIER);
  const minutes = r.kind === "bonus_minutes_out" ? r.quantity : null;
  const pointsPerMinute = minutes ? r.points / minutes : null;
  // Minutes never cheaper than the missions' rate: 1 500 mission points never buy more than the old 150 minutes.
  const ok = r.points > 0 && r.quantity > 0 && r.monthlyLimit >= 0 && shareAtMaxCampaign <= MAX_REWARD_COST_SHARE && (pointsPerMinute === null || pointsPerMinute >= MISSION_POINTS_PER_MINUTE);
  return {
    id: r.id,
    costCad: round4(costCad),
    costPerPointCad: round4(costPerPointCad),
    shareAtBaseRate: round4(shareAtBaseRate),
    shareAtMaxCampaign: round4(shareAtMaxCampaign),
    pointsPerMinute,
    ok,
  };
}

/** Rewards whose price breaks the rule, with their numbers; [] when the whole catalog passes. */
export function pointsCatalogViolations(catalog: readonly PointsReward[], rates: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD, a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS): RewardEconomics[] {
  return catalog.filter((r) => r.enabled).map((r) => rewardEconomics(r, rates, a)).filter((e) => !e.ok);
}

// ------------------------------------------------------------------------------------------- API

export interface PointsEntryDto {
  id: string;
  /** Positive: earned or refunded. Negative: redeemed, expired or clawed back. 0: earned over a cap, or a clawback with nothing left to take (kept for the record). */
  delta: number;
  reason: PointsReason;
  /** Where it came from, without personal data: "mission:choose_handle", "invoice", "store", "reward:texts_50"… */
  label: string;
  campaignName: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface PointsCampaignDto {
  id: string;
  name: string;
  kind: "multiplier" | "bonus";
  target: PointsCampaignTarget;
  /** multiplier campaigns: x2 = double points. */
  multiplier: number | null;
  /** bonus campaigns: fixed points, once per account. */
  bonusPoints: number | null;
  startsAt: string;
  endsAt: string;
}

/** Admin view of a campaign (budget included). */
export interface PointsCampaignAdminDto extends PointsCampaignDto {
  budgetPoints: number;
  spentPoints: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PointsRewardDto extends Omit<PointsReward, "enabled"> {
  /** The account may take it now (eligibility, monthly limit, balance). */
  available: boolean;
  /** Why not, when not: "balance", "plan", "monthly_limit", "paused". */
  unavailableReason: "balance" | "plan" | "monthly_limit" | "paused" | null;
  usedThisMonth: number;
}

/** GET /v1/points */
export interface PointsResponse {
  /** false when the POINTS kill switch is off: nothing is earned or redeemed. */
  enabled: boolean;
  balance: number;
  lifetimeEarned: number;
  /** Points still owed after a refund or chargeback the balance could not cover: taken from the next points earned. */
  owed: number;
  history: PointsEntryDto[];
  campaigns: PointsCampaignDto[];
  rules: {
    pointsPerDollar: number;
    referralPoints: number;
    missionPointsCap: number;
    dailyEarnCap: number;
    monthlyEarnCap: number;
    /** Months without any points activity before the balance expires; null when expiry is off. */
    expiryMonths: number | null;
  };
}

/** GET /v1/points/catalog */
export interface PointsCatalogResponse {
  enabled: boolean;
  balance: number;
  rewards: PointsRewardDto[];
}

/** POST /v1/points/redeem */
export interface PointsRedeemRequest {
  rewardId: PointsRewardId;
  /** Client-generated (UUID); the same key never redeems twice. */
  idempotencyKey: string;
}
export interface PointsRedeemResponse {
  redemptionId: string;
  rewardId: PointsRewardId;
  status: "fulfilled";
  points: number;
  balance: number;
  /** ad_free_days: when the ad-free period ends. */
  until?: string;
  /** True when this key was already used: nothing new was debited. */
  replay: boolean;
}

/** POST /v1/admin/points/campaigns */
export interface PointsCampaignCreateRequest {
  name: string;
  kind: "multiplier" | "bonus";
  target: PointsCampaignTarget;
  multiplier?: number;
  bonusPoints?: number;
  startsAt: string;
  endsAt: string;
  budgetPoints: number;
}
/** PATCH /v1/admin/points/campaigns/:id */
export interface PointsCampaignUpdateRequest {
  name?: string;
  endsAt?: string;
  budgetPoints?: number;
  active?: boolean;
}

/** Sent in a route's response when it just earned points (for the celebration toast). */
export interface PointsEarnedDto {
  points: number;
  balance: number;
}
