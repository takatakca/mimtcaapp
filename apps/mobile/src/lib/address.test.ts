import { describe, expect, it } from "vitest";
import { normalizePostalCode, postalMatchesProvince } from "./address";
import { nextOnboardingStep, sortAreaCodes } from "./onboarding";

describe("postal codes", () => {
  it("normalizes to A1A 1A1", () => {
    expect(normalizePostalCode("h3b1a1")).toBe("H3B 1A1");
    expect(normalizePostalCode(" G1R  4P5 ")).toBe("G1R 4P5");
  });
  it("rejects invalid codes", () => {
    for (const bad of ["12345", "H3B1A", "D3B 1A1", "W1A 1A1", "H3B 1O1", ""]) expect(normalizePostalCode(bad)).toBeNull();
  });
  it("checks the province", () => {
    expect(postalMatchesProvince("H3B 1A1", "QC")).toBe(true);
    expect(postalMatchesProvince("M5V 2T6", "QC")).toBe(false);
    expect(postalMatchesProvince("X0A 0H0", "NU")).toBe(true);
  });
});

describe("onboarding", () => {
  const base = { e911: { addressRegistered: true, noticeAccepted: true, noticeVersion: "1" }, numbers: [] };
  it("orders the steps address → notice → number", () => {
    expect(nextOnboardingStep({ ...base, e911: { ...base.e911, addressRegistered: false } })).toBe("address");
    expect(nextOnboardingStep({ ...base, e911: { ...base.e911, noticeAccepted: false } })).toBe("notice");
    expect(nextOnboardingStep(base)).toBe("number");
    expect(nextOnboardingStep({ ...base, numbers: [{ id: "n", e164: "+15145550123", state: "active" }] })).toBeNull();
  });
  it("skips the number step on the free plan (no phone-network number), not on a paid plan", () => {
    expect(nextOnboardingStep({ ...base, account: { plan: "free" } })).toBeNull();
    expect(nextOnboardingStep({ ...base, account: { plan: "lock" } })).toBe("number");
    expect(nextOnboardingStep({ ...base, account: { plan: "free" }, e911: { ...base.e911, noticeAccepted: false } })).toBe("notice");
  });
  it("puts Montréal area codes first", () => {
    expect(sortAreaCodes(["819", "418", "514", "438"]).slice(0, 2)).toEqual(["514", "438"]);
  });
});
