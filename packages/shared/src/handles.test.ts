import { describe, expect, it } from "vitest";
import { isHandle, normalizeHandle, RESERVED_HANDLES } from "./handles.js";

describe("MIMT handles", () => {
  it("normalises what people type", () => {
    expect(normalizeHandle("Camille.T")).toBe("@camille.t");
    expect(normalizeHandle(" @@cafe_lumiere ")).toBe("@cafe_lumiere");
  });
  it("refuses too short, too long, bad characters and doubled separators", () => {
    for (const bad of ["ab", "a".repeat(21), "jean paul", "émilie", ".camille", "camille_", "ca..mille", "+15145550101", ""]) expect(normalizeHandle(bad)).toBeNull();
  });
  it("tells handles from phone numbers", () => {
    expect(isHandle("@camille")).toBe(true);
    expect(isHandle("+15145550101")).toBe(false);
  });
  it("reserves staff, brand and emergency names", () => {
    expect(RESERVED_HANDLES.has("@mimt")).toBe(true);
    expect(RESERVED_HANDLES.has("@911")).toBe(true);
  });
});
