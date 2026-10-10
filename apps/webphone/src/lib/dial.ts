// Dial pad and phone-number helpers (pure, unit-tested). Adapted from apps/mobile/src/lib/dial.ts.
import { NANP_E164, isEmergencyNumber } from "@mimt/shared";

/** Keep only what a dial pad can type: digits, *, # and a single leading +. */
export function normalizeDialInput(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d*#]/g, "");
}

/**
 * What to send to Twilio (`To` param) for a typed number.
 * - 9-1-1 in any form becomes "911" (never rewritten to E.164, never blocked).
 * - 10 digits, or 11 digits starting with 1, become NANP E.164 (+1NXXNXXXXXX).
 * - Anything else returns null (invalid for PSTN from the web).
 */
export function toDialable(input: string): string | null {
  if (isEmergencyNumber(input)) return "911";
  const n = normalizeDialInput(input);
  if (/[*#]/.test(n)) return null;
  const digits = n.replace(/\D/g, "");
  let e164: string | null = null;
  if (n.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  return e164 && NANP_E164.test(e164) ? e164 : null;
}

/** NANP E.164 check for external targets (IVR, forwarding): Canada/US only, never 9-1-1. */
export function isNanpE164(value: string): boolean {
  return NANP_E164.test(value);
}

/** Display a NANP number the Quebec way: "514 555-0123". Leaves other input unchanged. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  if (isEmergencyNumber(value)) return "9-1-1";
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value;
  return `${national.slice(0, 3)} ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** Progressive formatting while typing on the dial pad. */
export function formatAsYouType(input: string): string {
  const n = normalizeDialInput(input);
  if (n.startsWith("+") || /[*#]/.test(n) || n.length <= 3 || isEmergencyNumber(n)) return n;
  const lead = n.startsWith("1") && n.length > 10 ? "1 " : "";
  const d = lead ? n.slice(1) : n;
  if (d.length <= 3) return lead + d;
  if (d.length <= 6) return `${lead}${d.slice(0, 3)} ${d.slice(3)}`;
  return `${lead}${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 10)}${d.slice(10)}`;
}

export interface CallGate {
  addressRegistered: boolean;
  noticeAccepted: boolean;
}

export type CallBlockReason = "invalid" | "e911_setup" | null;

/**
 * Why the UI would refuse to place this call, or null when it may. 9-1-1 is ALWAYS allowed from
 * the web: never gated by plan, caps, credit, onboarding or a missing 9-1-1 address (CRTC product
 * rule, docs/MIMT-REGULATORY.md §3). Other calls need a registered address and an accepted notice;
 * plan caps are enforced by the server.
 */
export function callBlockReason(dialed: string, gate: CallGate | null | undefined): CallBlockReason {
  if (isEmergencyNumber(dialed)) return null;
  if (!toDialable(dialed)) return "invalid";
  if (!gate || !gate.addressRegistered || !gate.noticeAccepted) return "e911_setup";
  return null;
}

export function canPlaceCall(dialed: string, gate: CallGate | null | undefined): boolean {
  return callBlockReason(dialed, gate) === null;
}

/** Keys a keyboard may type on the dial pad (also used for DTMF during a call). */
export const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;
export type DialKey = (typeof DIAL_KEYS)[number];

export const DIAL_LETTERS: Record<DialKey, string> = {
  "1": "", "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO",
  "7": "PQRS", "8": "TUV", "9": "WXYZ", "*": "", "0": "+", "#": "",
};

export function isDialKey(key: string): key is DialKey {
  return (DIAL_KEYS as readonly string[]).includes(key);
}
