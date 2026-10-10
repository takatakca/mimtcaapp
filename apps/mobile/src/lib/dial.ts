// Dial pad and phone-number helpers (pure, unit-tested).
import { NANP_E164, isEmergencyNumber } from "@mimt/shared";

/** Keep only what a dial pad can type: digits, *, # and a single leading +. */
export function normalizeDialInput(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d*#]/g, "");
}

/**
 * What to send to the voice/SMS API for a typed number.
 * - 9-1-1 in any form becomes "911" (never rewritten to E.164, never blocked).
 * - 10 digits, or 11 digits starting with 1, become NANP E.164 (+1NXXNXXXXXX).
 * - Anything else returns null (invalid for PSTN from the app).
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

/**
 * Like toDialable, plus international numbers typed with + or 011 (voice only: texts stay Canada/US).
 * The server decides whether the plan, credit and destination list allow it; the dial screen shows
 * the rate first (GET /v1/rates).
 */
export function toDialableVoice(input: string): string | null {
  const domestic = toDialable(input);
  if (domestic) return domestic;
  const n = normalizeDialInput(input);
  if (/[*#]/.test(n)) return null;
  const digits = n.replace(/\D/g, "");
  const intl = n.startsWith("+") ? digits : digits.startsWith("011") ? digits.slice(3) : null;
  if (!intl || intl.startsWith("1")) return null;
  return /^[2-9]\d{6,14}$/.test(intl) ? `+${intl}` : null;
}

/**
 * The number to ask GET /v1/rates about while typing, or null (incomplete, 9-1-1). The server says
 * whether it is domestic (no rate line) or international, Caribbean +1 codes included.
 */
export function rateQuoteTarget(input: string): string | null {
  const to = toDialableVoice(input);
  return to && to !== "911" ? to : null;
}

/** Display a NANP number the Quebec way: "514 555-0123". Leaves other input unchanged. */
export function formatPhone(value: string): string {
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

/**
 * Whether the UI lets the user place this call. 9-1-1 is ALWAYS allowed: never gated by plan,
 * caps, credit or onboarding (CRTC product rule, docs/MIMT-REGULATORY.md §3). Other calls need a
 * registered 9-1-1 address and an accepted notice; plan caps are enforced by the server.
 */
export function canPlaceCall(dialed: string, gate: CallGate | null | undefined): boolean {
  if (isEmergencyNumber(dialed)) return true;
  if (!toDialableVoice(dialed)) return false;
  return !!gate && gate.addressRegistered && gate.noticeAccepted;
}
