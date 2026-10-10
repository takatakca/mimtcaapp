// Consumer call controls: call blocking, call forwarding and do not disturb (quiet hours).
// Parity P0 items 2-3 and P1 item 7 (docs/MIMT-PARITY.md). 9-1-1 is never affected by any of these.

import { WEEKDAYS, type Weekday, type WeeklySchedule } from "./business.js";

// --------------------------------------------------------------------------------------- blocks

/** A number the user blocked: its calls are rejected (or sent to voicemail), its texts are dropped. */
export interface BlockedNumberDto {
  id: string;
  e164: string;
  label: string | null;
  createdAt: string;
}

/** GET /v1/blocks */
export interface BlocksResponse {
  blocks: BlockedNumberDto[];
}

/** POST /v1/blocks → 201 (200 when already blocked). */
export interface BlockNumberRequest {
  /** E.164 or a dialable North American number ("514 555-0123"). 9-1-1 cannot be blocked. */
  number: string;
  label?: string | null;
}

// ----------------------------------------------------------------------------------- forwarding

/** off: ring the apps. always: dial the target straight away. no_answer: ring the apps, then the target. */
export type ForwardingMode = "off" | "always" | "no_answer";

export const FORWARDING_TIMEOUT_MIN_S = 5;
export const FORWARDING_TIMEOUT_MAX_S = 60;
export const FORWARDING_TIMEOUT_DEFAULT_S = 20;

export interface ForwardingSettings {
  mode: ForwardingMode;
  /** E.164, Canada/US only. Required unless mode is "off". */
  target: string | null;
  /** Seconds the apps ring before forwarding (no_answer only). */
  timeoutS: number;
}

// ---------------------------------------------------------------------------- do not disturb

/**
 * Do not disturb: inbound calls go straight to voicemail.
 * enabled + schedule null = on all the time; enabled + schedule = only during the quiet hours.
 * Schedule ranges are "HH:MM" in America/Montreal; a range whose close is not after its open wraps
 * past midnight (22:00 → 07:00 on "mon" covers Monday 22:00 to Tuesday 07:00).
 */
export interface DoNotDisturbSettings {
  enabled: boolean;
  schedule: WeeklySchedule | null;
}

/** What happens to calls from blocked numbers. */
export type BlockedCallAction = "reject" | "voicemail";

export interface CallSettings {
  forwarding: ForwardingSettings;
  dnd: DoNotDisturbSettings;
  blockedCallAction: BlockedCallAction;
}

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  forwarding: { mode: "off", target: null, timeoutS: FORWARDING_TIMEOUT_DEFAULT_S },
  dnd: { enabled: false, schedule: null },
  blockedCallAction: "reject",
};

/** Partial update carried by PATCH /v1/me. */
export interface CallSettingsPatch {
  forwarding?: { mode: ForwardingMode; target?: string | null; timeoutS?: number };
  dnd?: { enabled: boolean; schedule?: WeeklySchedule | null };
  blockedCallAction?: BlockedCallAction;
}

// ---------------------------------------------------------------------------------- schedule

const MONTREAL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Montreal",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WEEKDAY_BY_SHORT: Record<string, Weekday> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export const isValidHhmm = (s: string) => HHMM.test(s);
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when `at` falls inside one of the schedule's ranges (America/Montreal, overnight ranges wrap). */
export function inQuietHours(schedule: WeeklySchedule, at: Date): boolean {
  const parts = Object.fromEntries(MONTREAL.formatToParts(at).map((p) => [p.type, p.value]));
  const today = WEEKDAY_BY_SHORT[parts.weekday ?? ""] ?? "mon";
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(today) + 6) % 7]!;
  for (const r of schedule[today] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  // Overnight ranges that started yesterday.
  for (const r of schedule[yesterday] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close <= open && minutes < close) return true;
  }
  return false;
}

/** True when do not disturb sends calls to voicemail at `at`. */
export function dndActive(dnd: DoNotDisturbSettings, at: Date): boolean {
  if (!dnd.enabled) return false;
  return dnd.schedule ? inQuietHours(dnd.schedule, at) : true;
}
