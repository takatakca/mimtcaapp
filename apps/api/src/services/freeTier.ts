import type { AppDeps } from "../deps.js";
import { dayPeriod, monthPeriod } from "../lib/time.js";

/**
 * Free-tier cost guard. The free plan is paid for by ads (docs/MIMT-STACK.md §2: about C$6 per free user per month
 * on Twilio), so MIMT caps how much the free tier can cost before ad revenue is measured:
 *
 *  - FREE_NEW_NUMBERS_PER_DAY / FREE_ACTIVE_NUMBERS_MAX / FREE_SIGNUPS_ENABLED: new free numbers per UTC day and
 *    free numbers held in total (number claim → 409).
 *  - FREE_OUTBOUND_PSTN_ENABLED / FREE_TIER_MONTHLY_BUDGET_CAD: free-plan outbound PSTN calls and SMS.
 *
 * Never applies to 9-1-1 (handled before any check in routes/twilioVoice.ts), app-to-app calls and texts, inbound
 * calls and texts, or paid plans.
 */

/** Fixed monthly cost of one held number (docs/MIMT-STACK.md §2: number 1.60 + 9-1-1 1.04, CAD). */
export const FREE_NUMBER_FIXED_CAD_PER_MONTH = 2.64;

/** SMS segments are not priced in the usage ledger: docs/MIMT-STACK.md §2 estimate (C$0.023 per outbound segment). */
export const FREE_SMS_EST_CAD_PER_SEGMENT = 0.023;

export const FREE_QUOTA_MESSAGE =
  "Les numéros gratuits du jour sont tous attribués. Revenez demain ou choisissez Essentiel (12,99 $) ou Premium.";

/** Launch pricing: a phone-network number comes with a paid plan (Essentiel 12,99 $ and up), paid up front. */
export const NUMBER_REQUIRES_PAID_MESSAGE =
  "Le forfait Gratuit ne comprend pas de numéro de téléphone. Choisissez Essentiel (12,99 $/mois) pour obtenir votre numéro tout de suite.";

export const FREE_OUTBOUND_PAUSED_MESSAGE =
  "Les appels et textos vers le réseau téléphonique sont en pause pour le forfait gratuit jusqu'au mois prochain. " +
  "Les appels et textos entre applications MIMT restent permis. Passez à Essentiel (12,99 $) ou Premium pour continuer.";

export const FREE_OUTBOUND_PAUSED_TWIML = {
  fr: "Les appels vers le réseau téléphonique sont en pause pour le forfait gratuit. Les appels entre applications MIMT restent gratuits. Passez au forfait Essentiel ou Premium dans l'application.",
  en: "Calls to the phone network are paused on the free plan. Calls between MIMT apps stay free. Upgrade to Essential or Premium in the app.",
} as const;

const startOfUtcDay = (d: Date) => new Date(`${dayPeriod(d)}T00:00:00.000Z`);

export interface FreeTierCosts {
  month: string;
  freeSpendCad: number;
  budgetCad: number;
  budgetReached: boolean;
  outboundEnabled: boolean;
  freeNumbersToday: number;
  capToday: number;
  activeFreeNumbers: number;
  activeFreeMax: number;
  /** activeFreeNumbers × FREE_NUMBER_FIXED_CAD_PER_MONTH (number rental + 9-1-1), not in freeSpendCad. */
  estimatedFixedMonthlyCad: number;
  signupsEnabled: boolean;
}

/** Estimated Twilio spend of the free tier this UTC month: rated calls in the ledger + outbound SMS estimate. */
export async function freeTierSpendCad(deps: AppDeps, now: Date = deps.now()): Promise<number> {
  const usage = await deps.repo.freePlanUsage(monthPeriod(now), now);
  return Math.round((usage.spendCad + usage.smsOut * FREE_SMS_EST_CAD_PER_SEGMENT) * 100) / 100;
}

/** Why free-plan outbound PSTN (calls and SMS) is refused right now, or null when it is allowed. */
export async function freeOutboundBlock(deps: AppDeps, now: Date = deps.now()): Promise<"free_outbound_disabled" | "free_budget_reached" | null> {
  if (!deps.config.FREE_OUTBOUND_PSTN_ENABLED) return "free_outbound_disabled";
  if ((await freeTierSpendCad(deps, now)) >= deps.config.FREE_TIER_MONTHLY_BUDGET_CAD) return "free_budget_reached";
  return null;
}

/** True when one more free number may be handed out today. */
export async function freeNumberAvailable(deps: AppDeps, now: Date = deps.now()): Promise<boolean> {
  if (!deps.config.FREE_SIGNUPS_ENABLED) return false;
  const cap = deps.config.FREE_NEW_NUMBERS_PER_DAY;
  const max = deps.config.FREE_ACTIVE_NUMBERS_MAX;
  if (cap <= 0 || max <= 0) return false;
  if ((await deps.repo.countActiveFreeNumbers(now)) >= max) return false;
  return (await deps.repo.countFreeNumberClaimsSince(startOfUtcDay(now))) < cap;
}

export async function freeTierCosts(deps: AppDeps, now: Date = deps.now()): Promise<FreeTierCosts> {
  const { config } = deps;
  const [freeSpendCad, freeNumbersToday, activeFreeNumbers] = await Promise.all([
    freeTierSpendCad(deps, now),
    deps.repo.countFreeNumberClaimsSince(startOfUtcDay(now)),
    deps.repo.countActiveFreeNumbers(now),
  ]);
  return {
    month: monthPeriod(now),
    freeSpendCad,
    budgetCad: config.FREE_TIER_MONTHLY_BUDGET_CAD,
    budgetReached: freeSpendCad >= config.FREE_TIER_MONTHLY_BUDGET_CAD,
    outboundEnabled: config.FREE_OUTBOUND_PSTN_ENABLED,
    freeNumbersToday,
    capToday: config.FREE_SIGNUPS_ENABLED ? config.FREE_NEW_NUMBERS_PER_DAY : 0,
    activeFreeNumbers,
    activeFreeMax: config.FREE_ACTIVE_NUMBERS_MAX,
    estimatedFixedMonthlyCad: Math.round(activeFreeNumbers * FREE_NUMBER_FIXED_CAD_PER_MONTH * 100) / 100,
    signupsEnabled: config.FREE_SIGNUPS_ENABLED,
  };
}
