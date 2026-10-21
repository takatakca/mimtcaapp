import { describe, expect, it } from "vitest";
import { callBlockReason, canPlaceCall, formatAsYouType, formatPhone, normalizeDialInput, toDialable } from "./dial";

const ready = { addressRegistered: true, noticeAccepted: true };

describe("dial number normalisation", () => {
  it("keeps only dial-pad characters and a leading +", () => {
    expect(normalizeDialInput(" (514) 555-0123 ")).toBe("5145550123");
    expect(normalizeDialInput("+1 514 555 0123")).toBe("+15145550123");
    expect(normalizeDialInput("*67#")).toBe("*67#");
    expect(normalizeDialInput("12+34")).toBe("1234");
  });

  it("turns 10 and 11 digit NANP numbers into E.164", () => {
    expect(toDialable("514 555-0123")).toBe("+15145550123");
    expect(toDialable("1-514-555-0123")).toBe("+15145550123");
    expect(toDialable("+1 (438) 555-0142")).toBe("+14385550142");
  });

  it("refuses what is not a Canada/US number", () => {
    expect(toDialable("555-0123")).toBeNull();
    expect(toDialable("+33 1 23 45 67 89")).toBeNull();
    expect(toDialable("*67 514 555 0123")).toBeNull();
    expect(toDialable("011 555 0123")).toBeNull();
    expect(toDialable("")).toBeNull();
  });

  it("9-1-1 in any form becomes 911", () => {
    for (const v of ["911", "9-1-1", "9 1 1", "+1911", "1911"]) expect(toDialable(v)).toBe("911");
  });

  it("formats the Quebec way", () => {
    expect(formatPhone("+15145550123")).toBe("514 555-0123");
    expect(formatPhone("911")).toBe("9-1-1");
    expect(formatPhone("client:abc")).toBe("client:abc");
    expect(formatAsYouType("5145550")).toBe("514 555-0");
    expect(formatAsYouType("911")).toBe("911");
  });
});

describe("9-1-1 is never blocked", () => {
  it("allows 911 with no address, no notice, no gate at all", () => {
    for (const gate of [null, undefined, { addressRegistered: false, noticeAccepted: false }, ready]) {
      expect(callBlockReason("911", gate)).toBeNull();
      expect(callBlockReason("9-1-1", gate)).toBeNull();
      expect(canPlaceCall("+1 911", gate)).toBe(true);
    }
  });

  it("other calls need the 9-1-1 address and the accepted notice", () => {
    expect(callBlockReason("514 555-0123", null)).toBe("e911_setup");
    expect(callBlockReason("514 555-0123", { addressRegistered: true, noticeAccepted: false })).toBe("e911_setup");
    expect(callBlockReason("514 555-0123", { addressRegistered: false, noticeAccepted: true })).toBe("e911_setup");
    expect(callBlockReason("514 555-0123", ready)).toBeNull();
  });

  it("an invalid number is refused as invalid, not as 9-1-1 setup", () => {
    expect(callBlockReason("12345", ready)).toBe("invalid");
  });
});

describe("calls by MIMT handle", () => {
  it("allows @nom without a 9-1-1 address (app to app), refuses malformed handles", async () => {
    const { callBlockReason } = await import("./dial");
    expect(callBlockReason("@camille", null)).toBeNull();
    expect(callBlockReason("@a", null)).toBe("invalid");
    expect(callBlockReason("514 555 0123", null)).toBe("e911_setup");
  });
});
