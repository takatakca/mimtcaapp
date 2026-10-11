import { describe, expect, it } from "vitest";
import { assertE2eAllowed, E2E_OTP_CODE, E2E_PHONE, e2eTwilio } from "../e2e/server.js";

// The e2e server (fake Twilio Verify that accepts a fixed code) must never be startable in production.
describe("e2e server guard", () => {
  it("refuses without MIMT_E2E=1", () => {
    expect(() => assertE2eAllowed({})).toThrow(/MIMT_E2E=1/);
    expect(() => assertE2eAllowed({ MIMT_E2E: "true" })).toThrow(/MIMT_E2E=1/);
  });

  it("refuses in production even with MIMT_E2E=1", () => {
    expect(() => assertE2eAllowed({ NODE_ENV: "production", MIMT_E2E: "1" })).toThrow(/production/);
  });

  it("allows an explicit e2e run outside production", () => {
    expect(() => assertE2eAllowed({ NODE_ENV: "test", MIMT_E2E: "1" })).not.toThrow();
  });

  it("the fake Verify accepts only the fixed code for the e2e phone", async () => {
    const t = e2eTwilio();
    expect(await t.checkVerification(E2E_PHONE, E2E_OTP_CODE)).toBe(true);
    expect(await t.checkVerification(E2E_PHONE, "000000")).toBe(false);
    expect(await t.checkVerification("+15145550000", E2E_OTP_CODE)).toBe(false);
  });
});
