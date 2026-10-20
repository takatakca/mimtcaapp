// Plan prices and quotas, overridable from the environment, never past the unit-economics rule
// (docs/MIMT-UNIT-ECONOMICS.md: worst-case carrier cost ≤ 70 % of the price after Stripe fees).
//
//   PLAN_<CODE>_PRICE_CENTS, PLAN_<CODE>_OUT_MIN, PLAN_<CODE>_IN_MIN, PLAN_<CODE>_MESSAGES, PLAN_<CODE>_MMS
//   (<CODE>: LOCK — the Essentiel plan —, PREMIUM, BUSINESS, BUSINESS_PRO), FREE_ON_NET_MINUTES,
//   TWILIO_USD_* carrier rates and USD_TO_CAD.
//
// A paid plan that breaks the rule stops the API at startup with the numbers, instead of losing money per customer.
// The free plan has no price, so no rule: its cost is capped by FREE_* (services/freeTier.ts).

import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_CARRIER_RATES_USD,
  PLANS,
  planRuleViolations,
  type CarrierRatesUsd,
  type Plan,
  type PlanCode,
} from "@mimt/shared";

export type PlanTable = Record<PlanCode, Plan>;

const PAID: { code: Exclude<PlanCode, "free">; env: string }[] = [
  { code: "lock", env: "LOCK" },
  { code: "premium", env: "PREMIUM" },
  { code: "business", env: "BUSINESS" },
  { code: "business_pro", env: "BUSINESS_PRO" },
];

const RATE_ENV: Record<keyof CarrierRatesUsd, string> = {
  numberMonthly: "TWILIO_USD_NUMBER_MONTHLY",
  e911Monthly: "TWILIO_USD_E911_MONTHLY",
  pstnOutPerMin: "TWILIO_USD_PSTN_OUT_PER_MIN",
  pstnInPerMin: "TWILIO_USD_PSTN_IN_PER_MIN",
  appLegPerMin: "TWILIO_USD_APP_LEG_PER_MIN",
  sms: "TWILIO_USD_SMS",
  mms: "TWILIO_USD_MMS",
  verify: "TWILIO_USD_VERIFY",
  transcriptionPerMin: "TWILIO_USD_TRANSCRIPTION_PER_MIN",
  recordingPerMin: "TWILIO_USD_RECORDING_PER_MIN",
};

function num(env: Record<string, string | undefined>, key: string, fallback: number, opts: { int?: boolean } = {}): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (opts.int && !Number.isInteger(n))) throw new Error(`Invalid configuration: ${key} must be a ${opts.int ? "whole " : ""}number ≥ 0`);
  return n;
}

export function carrierRatesFromEnv(env: Record<string, string | undefined>): CarrierRatesUsd {
  const rates = { ...DEFAULT_CARRIER_RATES_USD };
  for (const [k, key] of Object.entries(RATE_ENV) as [keyof CarrierRatesUsd, string][]) rates[k] = num(env, key, rates[k]);
  return rates;
}

/** The plan table for this process: shared defaults + environment overrides, checked against the rule. Throws when broken. */
export function plansFromEnv(env: Record<string, string | undefined>, usdToCad = DEFAULT_ASSUMPTIONS.usdToCad): PlanTable {
  const plans = structuredClone(PLANS) as PlanTable;
  for (const { code, env: name } of PAID) {
    const p = plans[code];
    p.monthlyPriceCents = num(env, `PLAN_${name}_PRICE_CENTS`, p.monthlyPriceCents, { int: true });
    p.caps.outboundMinutes = num(env, `PLAN_${name}_OUT_MIN`, p.caps.outboundMinutes, { int: true });
    p.caps.inboundMinutes = num(env, `PLAN_${name}_IN_MIN`, p.caps.inboundMinutes, { int: true });
    p.caps.messages = num(env, `PLAN_${name}_MESSAGES`, p.caps.messages, { int: true });
    p.caps.mms = num(env, `PLAN_${name}_MMS`, p.caps.mms, { int: true });
    // A yearly price is only kept if it is not overridden away from the monthly one it was set against.
    if (env[`PLAN_${name}_PRICE_CENTS`]) delete p.yearlyPriceCents;
    if (p.monthlyPriceCents <= 0) throw new Error(`Invalid configuration: PLAN_${name}_PRICE_CENTS must be > 0 (paid plan)`);
  }
  plans.free.caps.onNetMinutes = num(env, "FREE_ON_NET_MINUTES", plans.free.caps.onNetMinutes ?? 0, { int: true });
  // Legacy free number (off by default): a free plan WITH a phone-network number, paid for by ads and capped only by
  // FREE_* (services/freeTier.ts). For numbers handed out before launch pricing, or a promotion the owner decides.
  if (env.PLAN_FREE_NUMBER === "true") {
    plans.free.caps.hasNumber = true;
    plans.free.caps.outboundMinutes = num(env, "PLAN_FREE_OUT_MIN", 30, { int: true });
    plans.free.caps.inboundMinutes = num(env, "PLAN_FREE_IN_MIN", 60, { int: true });
    plans.free.caps.messages = num(env, "PLAN_FREE_MESSAGES", 100, { int: true });
  }

  const broken = planRuleViolations(plans, carrierRatesFromEnv(env), { ...DEFAULT_ASSUMPTIONS, usdToCad });
  if (broken.length) {
    const detail = broken
      .map(({ code, economics: e }) => `${code}: worst-case cost ${e.worstCostCad} $ > 70 % of ${e.netCad} $ net (${Math.round(e.costShare * 100)} %)`)
      .join("; ");
    throw new Error(`Invalid configuration: plan loses money at worst case (docs/MIMT-UNIT-ECONOMICS.md): ${detail}`);
  }
  return plans;
}

// Process-wide table, set once by buildApp from the validated config. Defaults to the shared table (tests, jobs).
let active: PlanTable = PLANS;

export function setActivePlans(plans: PlanTable): void {
  active = plans;
}

export const planOf = (code: PlanCode): Plan => active[code];
