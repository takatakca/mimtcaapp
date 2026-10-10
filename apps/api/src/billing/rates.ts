import { FREE_PLAN_INTL_LIMITS, INTL_RATES_ARE_PLACEHOLDERS, intlRateFor, isEmergencyNumber, type PlanCode, type RateResponse } from "@mimt/shared";
import { checkVoiceDestination } from "../fraud/destinations.js";
import { classifyDestination, isDomesticZone } from "../lib/phone.js";

/** Retail CAD cents per started minute for an international destination (table, else the configured default). */
export function retailCentsPerMinute(e164: string, defaultCents: number): number {
  return intlRateFor(e164)?.centsPerMinute ?? defaultCents;
}

/** Longest international call the credit allows, in seconds (free plan also capped per call). */
export function intlTimeLimitS(input: { creditCents: number; centsPerMinute: number; freePlan: boolean; maxCallS: number }): number {
  const byCredit = Math.floor(input.creditCents / Math.max(1, input.centsPerMinute)) * 60;
  const cap = input.freePlan ? Math.min(input.maxCallS, FREE_PLAN_INTL_LIMITS.maxCallMinutes * 60) : input.maxCallS;
  return Math.min(byCredit, cap);
}

/** What GET /v1/rates answers. `to` is already normalised to E.164 (or is an emergency number). */
export function quoteRate(input: {
  to: string;
  plan: PlanCode;
  intlEntitled: boolean;
  creditCents: number;
  defaultCents: number;
}): RateResponse {
  const base = { currency: "CAD" as const, intlCreditCents: input.creditCents, placeholder: INTL_RATES_ARE_PLACEHOLDERS };
  // 9-1-1 is never blocked and never billed.
  if (isEmergencyNumber(input.to)) {
    return { ...base, to: input.to, kind: "emergency", country: null, centsPerMinute: 0, allowed: true, reason: null, minutesAvailable: null };
  }
  const zone = classifyDestination(input.to);
  if (isDomesticZone(zone)) {
    const country = zone === "ca" ? { fr: "Canada", en: "Canada" } : { fr: "États-Unis", en: "United States" };
    return { ...base, to: input.to, kind: "domestic", country, centsPerMinute: 0, allowed: true, reason: null, minutesAvailable: null };
  }
  const rate = intlRateFor(input.to);
  const centsPerMinute = rate?.centsPerMinute ?? input.defaultCents;
  const freePlan = input.plan === "free";
  const check = checkVoiceDestination(input.to, { entitled: input.intlEntitled, creditCents: input.creditCents }, { freePlan });
  // A free account that has not bought credit yet is "not entitled"; tell it whether this destination is
  // open to free-plan credit so the app can offer a top-up instead of a plain refusal.
  let reason: string | null = check.ok ? null : check.reason;
  if (!check.ok && check.reason === "intl_not_allowed" && freePlan) {
    const withCredit = checkVoiceDestination(input.to, { entitled: true, creditCents: 1 }, { freePlan: true });
    reason = withCredit.ok ? "intl_no_credit" : "destination_blocked";
  }
  const minutes = Math.floor(input.creditCents / Math.max(1, centsPerMinute));
  return {
    ...base,
    to: input.to,
    kind: "international",
    country: rate?.country ?? null,
    centsPerMinute,
    allowed: check.ok && minutes >= 1,
    reason: check.ok && minutes < 1 ? "intl_no_credit" : reason,
    minutesAvailable: minutes,
  };
}
