import type { Meeting } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { activeMeetings, meetingWebUrl } from "./meetings";

const m = (id: string, status: Meeting["status"], scheduledStart: string | null, joinUrl = `https://app.mimt.ca/reunions/${id}`) =>
  ({ id, status, scheduledStart, createdAt: "2026-10-01T00:00:00Z", joinUrl }) as Meeting;

describe("mobile meetings", () => {
  it("lists live first, then upcoming by date, without ended meetings", () => {
    const list = [m("a", "scheduled", "2026-10-20T10:00:00Z"), m("b", "ended", null), m("c", "live", null), m("d", "scheduled", "2026-10-18T10:00:00Z")];
    expect(activeMeetings(list).map((x) => x.id)).toEqual(["c", "d", "a"]);
  });

  it("opens only app.mimt.ca https links", () => {
    expect(meetingWebUrl(m("a", "live", null))).toBe("https://app.mimt.ca/reunions/a");
    expect(meetingWebUrl(m("a", "live", null, "https://evil.example/reunions/a"))).toBe("https://app.mimt.ca/reunions/a");
    expect(meetingWebUrl(m("a b", "live", null, "not a url"))).toBe("https://app.mimt.ca/reunions/a%20b");
  });
});
