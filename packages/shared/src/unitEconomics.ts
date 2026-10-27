// Unit economics: the worst-case Twilio cost of one customer on a plan, against what MIMT keeps of the price.
// Rule (owner, 2026-10-20): worst-case cost per plan ≤ 70 % of the price after Stripe fees. Never lose money per user.
// "Worst case" = every quota used to the last unit, in its most expensive form. docs/MIMT-UNIT-ECONOMICS.md has the table.
// Every number is overridable (API env, see apps/api config) because carrier prices and the exchange rate move.

import type { Plan, PlanCaps } from "./plans.js";

/** Twilio list prices for Canada, USD (owner's sheet, 2026-10-20). */
export interface CarrierRatesUsd {
  /** Local Canadian number, per month. */
  numberMonthly: number;
  /** 9-1-1 address registration per number, per month (Twilio Emergency Calling). */
  e911Monthly: number;
  /** Outbound call to the phone network, per minute. */
  pstnOutPerMin: number;
  /** Inbound call from the phone network, per minute. */
  pstnInPerMin: number;
  /** App or browser leg (Twilio Voice SDK), per minute, on every call including app-to-app. */
  appLegPerMin: number;
  /** SMS segment, outbound or inbound. */
  sms: number;
  /** MMS, outbound (inbound is cheaper; worst case uses this). */
  mms: number;
  /** One Twilio Verify check (SMS sign-in code). */
  verify: number;
  /** Voicemail transcription, per minute of audio. */
  transcriptionPerMin: number;
  /** Call recording, per minute (business plans with recording). */
  recordingPerMin: number;
}

export const DEFAULT_CARRIER_RATES_USD: CarrierRatesUsd = {
  numberMonthly: 1.15,
  e911Monthly: 0.75,
  pstnOutPerMin: 0.014,
  pstnInPerMin: 0.0085,
  appLegPerMin: 0.004,
  sms: 0.0083,
  mms: 0.022,
  verify: 0.05,
  transcriptionPerMin: 0.05,
  recordingPerMin: 0.0025,
};

export interface EconomicsAssumptions {
  /** CAD per USD. Conservative on purpose (a weak loonie raises every cost). */
  usdToCad: number;
  /** Stripe Canada, domestic cards: 2.9 % + C$0.30 per charge. */
  stripePercent: number;
  stripeFixedCad: number;
  /** Highest share of the net price the worst-case cost may reach. */
  maxCostShare: number;
  /** SMS sign-in codes paid per user per month (TAKATAK sign-in is free). */
  verifiesPerMonth: number;
}

export const DEFAULT_ASSUMPTIONS: EconomicsAssumptions = {
  usdToCad: 1.4,
  stripePercent: 0.029,
  stripeFixedCad: 0.3,
  maxCostShare: 0.7,
  verifiesPerMonth: 2,
};

/** Everything one user (or one business line) can consume in a month. Messages count both directions. */
export interface UsageQuota {
  /** A real phone number (rental + 9-1-1 registration). */
  hasNumber: boolean;
  outboundMinutes: number;
  inboundMinutes: number;
  /** SMS + MMS, sent and received. */
  messages: number;
  /** Of `messages`, how many may be MMS. */
  mms: number;
  /** App-to-app call minutes (one app leg per user). */
  onNetMinutes: number;
  transcriptionMinutes: number;
  recordingMinutes: number;
}

export interface CostLine {
  key: keyof UsageQuota | "verify";
  usd: number;
}

export interface PlanEconomics {
  priceCad: number;
  stripeFeeCad: number;
  netCad: number;
  worstCostCad: number;
  /** worstCostCad / netCad (0 when the plan is free). */
  costShare: number;
  ok: boolean;
  lines: CostLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Worst-case carrier cost of a quota, USD, line by line. */
export function worstCaseCostUsd(q: UsageQuota, r: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD, a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS): CostLine[] {
  const mms = Math.min(q.mms, q.messages);
  const lines: CostLine[] = [
    { key: "hasNumber", usd: q.hasNumber ? r.numberMonthly + r.e911Monthly : 0 },
    // Every PSTN call also has the app leg on MIMT's side.
    { key: "outboundMinutes", usd: q.outboundMinutes * (r.pstnOutPerMin + r.appLegPerMin) },
    { key: "inboundMinutes", usd: q.inboundMinutes * (r.pstnInPerMin + r.appLegPerMin) },
    { key: "messages", usd: (q.messages - mms) * r.sms + mms * r.mms },
    { key: "onNetMinutes", usd: q.onNetMinutes * r.appLegPerMin },
    { key: "transcriptionMinutes", usd: q.transcriptionMinutes * r.transcriptionPerMin },
    { key: "recordingMinutes", usd: q.recordingMinutes * r.recordingPerMin },
    { key: "verify", usd: a.verifiesPerMonth * r.verify },
  ];
  return lines;
}

/** Price vs worst-case cost for one plan. `priceCents` is CAD before taxes (taxes are collected on top). */
export function planEconomics(
  priceCents: number,
  q: UsageQuota,
  r: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD,
  a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS,
): PlanEconomics {
  const priceCad = priceCents / 100;
  const stripeFeeCad = priceCad > 0 ? round2(priceCad * a.stripePercent + a.stripeFixedCad) : 0;
  const netCad = round2(priceCad - stripeFeeCad);
  const lines = worstCaseCostUsd(q, r, a);
  const worstCostCad = round2(lines.reduce((s, l) => s + l.usd, 0) * a.usdToCad);
  const costShare = netCad > 0 ? Math.round((worstCostCad / netCad) * 1000) / 1000 : 0;
  return { priceCad, stripeFeeCad, netCad, worstCostCad, costShare, ok: netCad > 0 && worstCostCad <= netCad * a.maxCostShare, lines };
}

const quota = (q: Partial<UsageQuota>): UsageQuota => ({
  hasNumber: true,
  outboundMinutes: 0,
  inboundMinutes: 0,
  messages: 0,
  mms: 0,
  onNetMinutes: 0,
  transcriptionMinutes: 0,
  recordingMinutes: 0,
  ...q,
});

/**
 * Launch line-up sized to the rule (docs/MIMT-UNIT-ECONOMICS.md). Owner's suggestion, adjusted where it broke the
 * rule: Premium 250/400 min → 200/300 min. Free has no phone-network number: MIMT-to-MIMT texts (database, no
 * carrier) and fair-use app-to-app calls, paid for by ads. The trial is a card-on-file 7 days with a tiny quota.
 */
export const LAUNCH_LINEUP = {
  free: { priceCents: 0, quota: quota({ hasNumber: false, onNetMinutes: 120 }) },
  essentiel: { priceCents: 1299, quota: quota({ outboundMinutes: 60, inboundMinutes: 120, messages: 150 }) },
  premium: { priceCents: 2999, quota: quota({ outboundMinutes: 200, inboundMinutes: 300, messages: 400, mms: 50, transcriptionMinutes: 20 }) },
  business: { priceCents: 3499, quota: quota({ outboundMinutes: 300, inboundMinutes: 400, messages: 300, mms: 50, transcriptionMinutes: 20 }) },
  business_pro: {
    priceCents: 4499,
    quota: quota({ outboundMinutes: 350, inboundMinutes: 450, messages: 400, mms: 50, transcriptionMinutes: 20, recordingMinutes: 750 }),
  },
  trial: { priceCents: 0, quota: quota({ outboundMinutes: 20, inboundMinutes: 20, messages: 20 }) },
} as const satisfies Record<string, { priceCents: number; quota: UsageQuota }>;

export { quota as usageQuota };

/** The cost quota implied by plan caps (on-net minutes that draw from outbound minutes cost nothing extra). */
export function quotaFromCaps(caps: PlanCaps): UsageQuota {
  return {
    hasNumber: caps.hasNumber,
    outboundMinutes: caps.outboundMinutes,
    inboundMinutes: caps.inboundMinutes,
    messages: caps.messages,
    mms: caps.mms,
    onNetMinutes: caps.onNetMinutes ?? 0,
    transcriptionMinutes: caps.transcriptionMinutes,
    recordingMinutes: caps.recordingMinutes,
  };
}

/** Paid plans that break the rule, with their numbers; [] when every paid plan passes. */
export function planRuleViolations(
  plans: Record<string, Pick<Plan, "code" | "monthlyPriceCents" | "caps">>,
  r: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD,
  a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS,
): { code: string; economics: PlanEconomics }[] {
  return Object.values(plans)
    .filter((p) => p.monthlyPriceCents > 0)
    .map((p) => ({ code: p.code, economics: planEconomics(p.monthlyPriceCents, quotaFromCaps(p.caps), r, a) }))
    .filter((v) => !v.economics.ok);
}

// ---------------------------------------------------------------- annual plans (12 months for the price of 11)

/**
 * Ceiling for the YEARLY worst case, owner decision 2026-10-27 (« un mois gratuit si t'achètes pour un an »).
 * Separate from the monthly rule (maxCostShare 0.70), which stays as it is: the free month is a known margin cost.
 *
 * Why 0.80: a plan that passes the monthly 70 % rule reaches at most ≈ 76.4 % on its yearly price
 * (0.70 × 12 / (11 × (1 − 2.9 %)), the Stripe fee being charged once a year), so 0.80 never blocks a plan the
 * monthly rule accepts, while staying far from 100 % (cost = net: a loss). It is never applied above NEVER_A_LOSS.
 */
export const MAX_COST_SHARE_YEARLY = 0.8;
/** Hard limit for any price: the worst-case cost never reaches what MIMT keeps of it. */
export const NEVER_A_LOSS = 1;

export interface YearlyPlanEconomics extends PlanEconomics {
  /** priceCad is the yearly price, stripeFeeCad the one fee on it, netCad the yearly net; this is the net per month. */
  netPerMonthCad: number;
}

/**
 * Yearly price vs worst-case cost, per month. The customer pays `yearlyPriceCents` once (one Stripe fee, 2.9 % +
 * 0.30 $) and gets 12 months of the plan's monthly quotas. costShare = monthly worst case / (yearly net / 12).
 */
export function yearlyPlanEconomics(
  yearlyPriceCents: number,
  q: UsageQuota,
  r: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD,
  a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS,
  maxShare: number = MAX_COST_SHARE_YEARLY,
): YearlyPlanEconomics {
  const priceCad = yearlyPriceCents / 100;
  const stripeFeeCad = priceCad > 0 ? round2(priceCad * a.stripePercent + a.stripeFixedCad) : 0;
  const netCad = round2(priceCad - stripeFeeCad);
  const netPerMonthCad = round2(netCad / 12);
  const lines = worstCaseCostUsd(q, r, a);
  const worstCostCad = round2(lines.reduce((s, l) => s + l.usd, 0) * a.usdToCad);
  const costShare = netPerMonthCad > 0 ? Math.round((worstCostCad / netPerMonthCad) * 1000) / 1000 : 0;
  const ceiling = Math.min(maxShare, NEVER_A_LOSS);
  return { priceCad, stripeFeeCad, netCad, netPerMonthCad, worstCostCad, costShare, ok: netPerMonthCad > 0 && worstCostCad <= netPerMonthCad * ceiling, lines };
}

/** Paid plans whose yearly price breaks MAX_COST_SHARE_YEARLY (or would lose money); [] when all pass. */
export function yearlyPlanRuleViolations(
  plans: Record<string, Pick<Plan, "code" | "yearlyPriceCents" | "caps">>,
  r: CarrierRatesUsd = DEFAULT_CARRIER_RATES_USD,
  a: EconomicsAssumptions = DEFAULT_ASSUMPTIONS,
  maxShare: number = MAX_COST_SHARE_YEARLY,
): { code: string; economics: YearlyPlanEconomics }[] {
  return Object.values(plans)
    .filter((p) => (p.yearlyPriceCents ?? 0) > 0)
    .map((p) => ({ code: p.code, economics: yearlyPlanEconomics(p.yearlyPriceCents!, quotaFromCaps(p.caps), r, a, maxShare) }))
    .filter((v) => !v.economics.ok);
}
