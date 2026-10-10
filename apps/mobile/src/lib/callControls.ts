// Call blocking, forwarding and do-not-disturb helpers for the settings screens (pure, unit-tested).
import {
  isEmergencyNumber,
  WEEKDAYS,
  type BlockedNumberDto,
  type CallSettings,
  type Weekday,
  type WeeklySchedule,
} from "@mimt/shared";
import type { TKey } from "../i18n/core";
import { toDialable } from "./dial";

/** True when this conversation / call-log peer is on the block list. */
export function isBlockedPeer(blocks: readonly Pick<BlockedNumberDto, "e164">[] | null | undefined, peer: string): boolean {
  const e164 = toDialable(peer) ?? peer;
  return !!blocks?.some((b) => b.e164 === e164);
}

/** 9-1-1 can never be blocked (the API refuses it too); the menus hide the option. */
export const canBlock = (peer: string) => !isEmergencyNumber(peer) && toDialable(peer) !== null;

/** The simple quiet-hours form: one time range on chosen days (overnight allowed, e.g. 22:00 → 07:00). */
export interface QuietHours {
  start: string;
  end: string;
  days: Weekday[];
}

export const DEFAULT_QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00", days: [...WEEKDAYS] };

/** "7:30", "0730", "7h30" or "07:30" → "07:30"; null when not a valid time. */
export function parseTime(input: string): string | null {
  const m = /^\s*(\d{1,2})\s*[:h]?\s*(\d{2})?\s*$/i.exec(input);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function scheduleFromQuietHours(q: QuietHours): WeeklySchedule {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, q.days.includes(d) ? [{ open: q.start, close: q.end }] : []])) as WeeklySchedule;
}

/** Back to the simple form when the schedule has one identical range on every active day; else null. */
export function quietHoursFromSchedule(s: WeeklySchedule | null | undefined): QuietHours | null {
  if (!s) return null;
  const days = WEEKDAYS.filter((d) => (s[d] ?? []).length > 0);
  if (days.length === 0) return null;
  const first = s[days[0]!]![0]!;
  const uniform = days.every((d) => s[d]!.length === 1 && s[d]![0]!.open === first.open && s[d]![0]!.close === first.close);
  return uniform ? { start: first.open, end: first.close, days } : null;
}

/** One-line summary for the settings row. */
export function forwardingSummaryKey(settings: CallSettings | null | undefined): TKey {
  switch (settings?.forwarding.mode) {
    case "always":
      return "forwarding.summaryAlways";
    case "no_answer":
      return "forwarding.summaryNoAnswer";
    default:
      return "forwarding.summaryOff";
  }
}

export function dndSummaryKey(settings: CallSettings | null | undefined): TKey {
  if (!settings?.dnd.enabled) return "dnd.summaryOff";
  return settings.dnd.schedule ? "dnd.summaryScheduled" : "dnd.summaryOn";
}
