import { DEFAULT_CALL_SETTINGS } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n/fr";
import {
  canBlock,
  DEFAULT_QUIET_HOURS,
  dndSummaryKey,
  forwardingSummaryKey,
  isBlockedPeer,
  parseTime,
  quietHoursFromSchedule,
  scheduleFromQuietHours,
} from "./callControls";

describe("blocking helpers", () => {
  const blocks = [{ e164: "+14165550123" }];
  it("matches peers in any dialable form", () => {
    expect(isBlockedPeer(blocks, "+14165550123")).toBe(true);
    expect(isBlockedPeer(blocks, "416 555-0123")).toBe(true);
    expect(isBlockedPeer(blocks, "+15145550100")).toBe(false);
    expect(isBlockedPeer(null, "+14165550123")).toBe(false);
  });
  it("never offers to block 9-1-1", () => {
    expect(canBlock("911")).toBe(false);
    expect(canBlock("9-1-1")).toBe(false);
    expect(canBlock("+14165550123")).toBe(true);
    expect(canBlock("abc")).toBe(false);
  });
});

describe("quiet hours", () => {
  it("parses typed times", () => {
    expect(parseTime("7:30")).toBe("07:30");
    expect(parseTime("22h")).toBe("22:00");
    expect(parseTime("0730")).toBe("07:30");
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7:61")).toBeNull();
    expect(parseTime("soir")).toBeNull();
  });
  it("round-trips the simple form through a weekly schedule", () => {
    const weeknights = { start: "22:00", end: "07:00", days: ["mon", "tue", "wed", "thu", "fri"] as const };
    const s = scheduleFromQuietHours({ ...weeknights, days: [...weeknights.days] });
    expect(s.mon).toEqual([{ open: "22:00", close: "07:00" }]);
    expect(s.sat).toEqual([]);
    expect(quietHoursFromSchedule(s)).toEqual({ ...weeknights, days: [...weeknights.days] });
    expect(quietHoursFromSchedule(scheduleFromQuietHours(DEFAULT_QUIET_HOURS))).toEqual(DEFAULT_QUIET_HOURS);
  });
  it("returns null for schedules the simple form cannot show", () => {
    expect(quietHoursFromSchedule(null)).toBeNull();
    const mixed = scheduleFromQuietHours(DEFAULT_QUIET_HOURS);
    mixed.sun = [{ open: "20:00", close: "09:00" }];
    expect(quietHoursFromSchedule(mixed)).toBeNull();
  });
});

describe("summaries", () => {
  it("use keys that exist", () => {
    const keys = [
      forwardingSummaryKey(null),
      forwardingSummaryKey({ ...DEFAULT_CALL_SETTINGS, forwarding: { mode: "always", target: "+14385550147", timeoutS: 20 } }),
      forwardingSummaryKey({ ...DEFAULT_CALL_SETTINGS, forwarding: { mode: "no_answer", target: "+14385550147", timeoutS: 20 } }),
      dndSummaryKey(DEFAULT_CALL_SETTINGS),
      dndSummaryKey({ ...DEFAULT_CALL_SETTINGS, dnd: { enabled: true, schedule: null } }),
      dndSummaryKey({ ...DEFAULT_CALL_SETTINGS, dnd: { enabled: true, schedule: scheduleFromQuietHours(DEFAULT_QUIET_HOURS) } }),
    ];
    expect(new Set(keys).size).toBe(6);
    for (const k of keys) expect(fr[k]).toBeTruthy();
  });
});
