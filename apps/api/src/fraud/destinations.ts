import { classifyDestination, type DestinationZone } from "../lib/phone.js";

export type DestinationCheck = { ok: true; zone: DestinationZone } | { ok: false; zone: DestinationZone; reason: string };

/**
 * Voice destination policy (MIMT-MVP.md §7): Canada/US only by default; premium-rate NANP never;
 * Caribbean/territory NANP codes and international only with the intl entitlement and prepaid credit.
 */
export function checkVoiceDestination(
  e164: string,
  intl: { entitled: boolean; creditCents: number },
  opts: { freePlan?: boolean } = {},
): DestinationCheck {
  const zone = classifyDestination(e164);
  switch (zone) {
    case "ca":
    case "us":
      return { ok: true, zone };
    case "invalid":
      return { ok: false, zone, reason: "invalid_number" };
    case "nanp_premium":
      return { ok: false, zone, reason: "premium_rate_blocked" };
    case "nanp_high_cost":
    case "cuba":
    case "intl":
      if (!intl.entitled) return { ok: false, zone, reason: "intl_not_allowed" };
      if (opts.freePlan && !freePlanIntlAllowed(e164)) return { ok: false, zone, reason: "intl_not_allowed" };
      if (intl.creditCents <= 0) return { ok: false, zone, reason: "intl_no_credit" };
      return { ok: true, zone };
  }
}

/**
 * Free plan + prepaid credit (parity P1 item 9): a much shorter list than paid plans, limited to
 * low-fraud, low-cost destinations. No Caribbean/territory NANP codes, no Cuba, no satellite or
 * premium/shared-cost ranges, nothing known for international revenue share fraud.
 * Paid plans keep every destination checkVoiceDestination allows.
 */
export const FREE_PLAN_INTL_PREFIXES: readonly string[] = [
  "+33", // France
  "+32", // Belgique
  "+41", // Suisse
  "+44", // Royaume-Uni
  "+49", // Allemagne
  "+39", // Italie
  "+34", // Espagne
  "+351", // Portugal
  "+31", // Pays-Bas
  "+52", // Mexique
];

/** Premium-rate, shared-cost and personal-number ranges inside the free-plan countries: never on the free plan. */
export const FREE_PLAN_INTL_BLOCKED_PREFIXES: readonly string[] = [
  "+449", "+4470", "+4487", // UK 09 premium, 070 personal, 087 shared cost
  "+338", // France 08 special/premium numbers
  "+3290", // Belgium 090x premium
  "+41900", "+41901", "+41906", // Switzerland premium
  "+49900", "+49137", // Germany premium, televoting
  "+39899", "+39892", // Italy premium
  "+34803", "+34806", "+34807", "+34905", // Spain premium, televoting
  "+35160", "+35176", // Portugal premium
  "+31900", "+31906", "+31909", // Netherlands premium
  "+52900", // Mexico premium
];

export function freePlanIntlAllowed(e164: string): boolean {
  if (classifyDestination(e164) !== "intl") return false;
  if (FREE_PLAN_INTL_BLOCKED_PREFIXES.some((p) => e164.startsWith(p))) return false;
  return FREE_PLAN_INTL_PREFIXES.some((p) => e164.startsWith(p));
}

/** SMS goes to Canada/US only, whatever the plan. */
export function checkSmsDestination(e164: string): DestinationCheck {
  const zone = classifyDestination(e164);
  return zone === "ca" || zone === "us" ? { ok: true, zone } : { ok: false, zone, reason: "destination_not_allowed" };
}
