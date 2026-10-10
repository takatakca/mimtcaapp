import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKLY_SCHEDULE, type WeeklySchedule } from "./business.js";
import { dndActive, inQuietHours, isValidHhmm } from "./callControls.js";

const EMPTY: WeeklySchedule = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
// 2026-10-12 is a Monday. Montreal is UTC-4 in October.
const mtl = (local: string) => new Date(`${local}-04:00`);

describe("quiet hours", () => {
  it("matches a same-day range in Montreal time", () => {
    expect(inQuietHours(DEFAULT_WEEKLY_SCHEDULE, mtl("2026-10-12T09:00:00"))).toBe(true);
    expect(inQuietHours(DEFAULT_WEEKLY_SCHEDULE, mtl("2026-10-12T17:00:00"))).toBe(false);
    expect(inQuietHours(DEFAULT_WEEKLY_SCHEDULE, mtl("2026-10-11T10:00:00"))).toBe(false); // Sunday
  });

  it("wraps overnight ranges into the next day", () => {
    const nights: WeeklySchedule = { ...EMPTY, mon: [{ open: "22:00", close: "07:00" }] };
    expect(inQuietHours(nights, mtl("2026-10-12T21:59:00"))).toBe(false);
    expect(inQuietHours(nights, mtl("2026-10-12T23:30:00"))).toBe(true);
    expect(inQuietHours(nights, mtl("2026-10-13T06:59:00"))).toBe(true); // Tuesday morning
    expect(inQuietHours(nights, mtl("2026-10-13T07:00:00"))).toBe(false);
    expect(inQuietHours(nights, mtl("2026-10-13T23:00:00"))).toBe(false); // Tuesday night has no range
  });

  it("dnd: off, always on, or on during the schedule", () => {
    const at = mtl("2026-10-12T12:00:00");
    expect(dndActive({ enabled: false, schedule: null }, at)).toBe(false);
    expect(dndActive({ enabled: true, schedule: null }, at)).toBe(true);
    expect(dndActive({ enabled: true, schedule: EMPTY }, at)).toBe(false);
    expect(dndActive({ enabled: true, schedule: DEFAULT_WEEKLY_SCHEDULE }, at)).toBe(true);
  });

  it("validates HH:MM", () => {
    expect(isValidHhmm("07:30")).toBe(true);
    expect(isValidHhmm("24:00")).toBe(true);
    expect(isValidHhmm("24:01")).toBe(false);
    expect(isValidHhmm("7:30")).toBe(false);
  });
});
