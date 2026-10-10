import { DEFAULT_WEEKLY_SCHEDULE, type IvrMenuRequest } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { issueFor, normalizeExternal, validateIvrMenu, validateTarget, validateWeekly } from "./ivr";

const ctx = { extensionIds: ["e1", "e2"], ringGroupIds: ["g1"], ivrMenuIds: ["m1", "m2"], selfIvrId: "m1" };

const menu = (patch: Partial<IvrMenuRequest> = {}): IvrMenuRequest => ({
  name: "Menu principal",
  greeting: { fr: "Bonjour. Pour les ventes, faites le 1.", en: "" },
  options: [
    { digit: "1", target: { type: "extension", extensionId: "e1" } },
    { digit: "2", target: { type: "ring_group", ringGroupId: "g1" } },
  ],
  timeoutS: 6,
  maxRetries: 2,
  ...patch,
});

describe("IVR helpers", () => {
  it("normalises external numbers and never accepts 9-1-1", () => {
    expect(normalizeExternal("514 555-0123")).toBe("+15145550123");
    expect(normalizeExternal("911")).toBeNull();
    expect(normalizeExternal("9-1-1")).toBeNull();
    expect(normalizeExternal("123")).toBeNull();
  });

  it("accepts a valid bilingual menu (English optional)", () => {
    expect(validateIvrMenu(menu(), ctx)).toEqual([]);
  });

  it("requires a name, the French greeting and at least one option", () => {
    const issues = validateIvrMenu(menu({ name: " ", greeting: { fr: "", en: "Hello" }, options: [] }), ctx);
    expect(issues.map((i) => i.code).sort()).toEqual(["greeting_fr_required", "no_options", "required"]);
    // A recorded greeting replaces the French text.
    expect(issueFor(validateIvrMenu(menu({ greeting: { fr: "", en: "" }, greetingRecordingUrl: "https://x/a.mp3" }), ctx), "greeting.fr")).toBeUndefined();
  });

  it("flags duplicate and invalid digits", () => {
    const issues = validateIvrMenu(
      menu({
        options: [
          { digit: "1", target: { type: "hangup" } },
          { digit: "1", target: { type: "hangup" } },
          { digit: "A", target: { type: "hangup" } },
        ],
      }),
      ctx,
    );
    expect(issueFor(issues, "options.1.digit")?.code).toBe("duplicate_digit");
    expect(issueFor(issues, "options.2.digit")?.code).toBe("invalid_digit");
  });

  it("refuses to forward to 9-1-1 or outside Canada/US", () => {
    expect(validateTarget({ type: "external", number: "911" }, ctx, "t")).toEqual([{ field: "t", code: "external_emergency" }]);
    expect(validateTarget({ type: "external", number: "+33123456789" }, ctx, "t")).toEqual([{ field: "t", code: "external_not_nanp" }]);
    expect(validateTarget({ type: "external", number: "+15145550123" }, ctx, "t")).toEqual([]);
  });

  it("checks that targets exist and that a menu does not loop to itself", () => {
    expect(validateTarget({ type: "extension", extensionId: "nope" }, ctx, "t")[0]?.code).toBe("unknown_target");
    expect(validateTarget({ type: "ivr", ivrMenuId: "m1" }, ctx, "t")[0]?.code).toBe("self_reference");
    expect(validateTarget({ type: "ivr", ivrMenuId: "m2" }, ctx, "t")).toEqual([]);
    expect(validateTarget({ type: "voicemail" }, ctx, "t")).toEqual([]);
    expect(validateTarget(null, ctx, "t")[0]?.code).toBe("required");
  });

  it("bounds the timeout and retries", () => {
    const issues = validateIvrMenu(menu({ timeoutS: 60, maxRetries: 9 }), ctx);
    expect(issueFor(issues, "timeoutS")?.code).toBe("timeout_range");
    expect(issueFor(issues, "maxRetries")?.code).toBe("retries_range");
  });

  it("validates weekly hours: format, order and overlap", () => {
    expect(validateWeekly(DEFAULT_WEEKLY_SCHEDULE)).toEqual([]);
    const bad = {
      ...DEFAULT_WEEKLY_SCHEDULE,
      mon: [{ open: "9:00", close: "17:00" }],
      tue: [{ open: "17:00", close: "09:00" }],
      wed: [
        { open: "09:00", close: "13:00" },
        { open: "12:00", close: "17:00" },
      ],
    };
    const issues = validateWeekly(bad);
    expect(issueFor(issues, "weekly.mon.0")?.code).toBe("time_format");
    expect(issueFor(issues, "weekly.tue.0")?.code).toBe("time_order");
    expect(issueFor(issues, "weekly.wed")?.code).toBe("time_overlap");
  });
});
