import { describe, expect, it } from "vitest";
import { MEETING_MAX_DURATION_S, participantCap, parseParticipantMetadata } from "./meetings.js";
import { PLANS, planHas } from "./plans.js";

describe("video meetings in plans", () => {
  it("premium, business and business_pro include video_meetings; free and lock do not", () => {
    expect(planHas("premium", "video_meetings")).toBe(true);
    expect(planHas("business", "video_meetings")).toBe(true);
    expect(planHas("business_pro", "video_meetings")).toBe(true);
    expect(planHas("free", "video_meetings")).toBe(false);
    expect(planHas("lock", "video_meetings")).toBe(false);
  });

  it("caps participants by plan and limits a meeting to 4 hours", () => {
    expect(participantCap("premium")).toBe(4);
    expect(participantCap("business")).toBe(25);
    expect(participantCap("business_pro")).toBe(100);
    expect(participantCap("free")).toBeNull();
    for (const code of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
      expect(planHas(code, "video_meetings"), code).toBe(participantCap(code) !== null);
    }
    expect(MEETING_MAX_DURATION_S).toBe(14_400);
  });

  it("parses participant metadata defensively", () => {
    expect(parseParticipantMetadata('{"role":"guest","waiting":true}')).toEqual({ role: "guest", waiting: true });
    expect(parseParticipantMetadata('{"role":"host"}')).toEqual({ role: "host", waiting: false });
    expect(parseParticipantMetadata('{"role":"admin"}')).toBeNull();
    expect(parseParticipantMetadata("not json")).toBeNull();
    expect(parseParticipantMetadata(undefined)).toBeNull();
  });
});
