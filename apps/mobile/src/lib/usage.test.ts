import { describe, expect, it } from "vitest";
import { usageLevel, usagePercent, usageRows } from "./usage";

describe("usagePercent", () => {
  it("computes and clamps", () => {
    expect(usagePercent(15, 30)).toBe(50);
    expect(usagePercent(0, 30)).toBe(0);
    expect(usagePercent(45, 30)).toBe(100);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(-5, 30)).toBe(0);
  });
  it("treats a zero cap as full only when something was used", () => {
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(1, 0)).toBe(100);
  });
});

describe("usageLevel", () => {
  it("warns at 80 % and is full at 100 %", () => {
    expect(usageLevel(79)).toBe("ok");
    expect(usageLevel(80)).toBe("warn");
    expect(usageLevel(100)).toBe("full");
  });
});

describe("usageRows", () => {
  it("uses the plan caps from @mimt/shared", () => {
    const rows = usageRows("lock", { outboundMinutes: 48, inboundMinutes: 20, messages: 150 });
    expect(rows.map((r) => [r.key, r.cap, r.percent, r.level])).toEqual([
      ["outboundMinutes", 60, 80, "warn"],
      ["inboundMinutes", 120, 17, "ok"],
      ["messages", 150, 100, "full"],
    ]);
    expect(usageRows("premium", { outboundMinutes: 100, inboundMinutes: 0, messages: 0 })[0]?.percent).toBe(50);
  });

  it("shows no row for what the plan does not include (Gratuit: no phone-network minutes or texts)", () => {
    expect(usageRows("free", { outboundMinutes: 0, inboundMinutes: 0, messages: 0 })).toEqual([]);
  });
});
