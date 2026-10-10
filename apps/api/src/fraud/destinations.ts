import { classifyDestination, type DestinationZone } from "../lib/phone.js";

export type DestinationCheck = { ok: true; zone: DestinationZone } | { ok: false; zone: DestinationZone; reason: string };

/**
 * Voice destination policy (MIMT-MVP.md §7): Canada/US only by default; premium-rate NANP never;
 * Caribbean/territory NANP codes and international only with the intl entitlement and prepaid credit.
 */
export function checkVoiceDestination(e164: string, intl: { entitled: boolean; creditCents: number }): DestinationCheck {
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
      if (intl.creditCents <= 0) return { ok: false, zone, reason: "intl_no_credit" };
      return { ok: true, zone };
  }
}

/** SMS goes to Canada/US only, whatever the plan. */
export function checkSmsDestination(e164: string): DestinationCheck {
  const zone = classifyDestination(e164);
  return zone === "ca" || zone === "us" ? { ok: true, zone } : { ok: false, zone, reason: "destination_not_allowed" };
}
