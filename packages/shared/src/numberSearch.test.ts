import { describe, expect, it } from "vitest";
import { CANADIAN_AREA_CODES, formatNanp, NUMBER_PLACES, resolveNumberQuery, SUGGESTED_AREA_CODES } from "./numberSearch.js";
import { QUEBEC_AREA_CODES } from "./numbers.js";

describe("number picker query", () => {
  it("accepts an area code as typed", () => {
    expect(resolveNumberQuery("514")?.areaCodes).toEqual(["514"]);
    expect(resolveNumberQuery(" (438) ")?.areaCodes).toEqual(["438"]);
  });

  it("refuses non-Canadian or partial codes", () => {
    expect(resolveNumberQuery("212")).toBeNull();
    expect(resolveNumberQuery("51")).toBeNull();
    expect(resolveNumberQuery("")).toBeNull();
    expect(resolveNumberQuery("x")).toBeNull();
  });

  it("maps cities with or without accents, and prefixes", () => {
    expect(resolveNumberQuery("Montréal")?.areaCodes).toEqual(["514", "438", "263"]);
    expect(resolveNumberQuery("trois rivieres")?.label.fr).toBe("Trois-Rivières");
    expect(resolveNumberQuery("Québec")?.areaCodes).toContain("418");
    expect(resolveNumberQuery("toron")?.areaCodes).toEqual(["416", "647", "437"]);
  });

  it("every Québec area code and every place code is Canadian", () => {
    for (const c of QUEBEC_AREA_CODES) expect(CANADIAN_AREA_CODES[c]).toBe("QC");
    for (const c of SUGGESTED_AREA_CODES) expect(CANADIAN_AREA_CODES[c]).toBeDefined();
    for (const p of Object.values(NUMBER_PLACES)) for (const c of p.areaCodes) expect(CANADIAN_AREA_CODES[c]).toBeDefined();
  });

  it("formats numbers the Québec way", () => {
    expect(formatNanp("+15145550199")).toBe("514 555-0199");
    expect(formatNanp("+15145550199", "en")).toBe("(514) 555-0199");
  });
});
