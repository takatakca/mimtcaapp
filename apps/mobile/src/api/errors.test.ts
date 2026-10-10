import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { ApiClientError, errorKeyFor, toErrorKey } from "./errors";

describe("errorKeyFor (API error codes → messages)", () => {
  it("maps the codes apps/api actually sends", () => {
    expect(errorKeyFor(400, "invalid_request")).toBe("error.validation");
    expect(errorKeyFor(403, "e911_address_required")).toBe("error.e911Required");
    expect(errorKeyFor(403, "e911_ack_required")).toBe("error.e911Required");
    expect(errorKeyFor(409, "number_unavailable")).toBe("error.numberTaken");
    expect(errorKeyFor(403, "sms_quota_exhausted")).toBe("error.capReached");
    expect(errorKeyFor(403, "mms_not_in_plan")).toBe("error.featureRequired");
    expect(errorKeyFor(429, "new_recipient_limit")).toBe("error.rateLimited");
    expect(errorKeyFor(501, "not_implemented")).toBe("error.notImplemented");
  });

  it("maps call blocking and forwarding refusals", () => {
    expect(errorKeyFor(400, "cannot_block_emergency")).toBe("error.cannotBlockEmergency");
    expect(errorKeyFor(409, "block_limit")).toBe("error.blockLimit");
    expect(errorKeyFor(400, "forwarding_destination_not_allowed")).toBe("error.forwardingDestination");
    expect(errorKeyFor(400, "forwarding_target_required")).toBe("error.forwardingTarget");
    expect(errorKeyFor(403, "plan_required")).toBe("error.featureRequired");
  });

  it("falls back on the HTTP status", () => {
    expect(errorKeyFor(null)).toBe("error.network");
    expect(errorKeyFor(401, "unauthorized")).toBe("error.session");
    expect(errorKeyFor(404, "not_found")).toBe("error.notFound");
    expect(errorKeyFor(501, null)).toBe("error.notImplemented");
    expect(errorKeyFor(503, "not_configured")).toBe("error.server");
    expect(errorKeyFor(418, "teapot")).toBe("error.generic");
  });

  it("every mapped key exists in both languages, with a friendly French 'coming soon'", () => {
    for (const code of ["invalid_request", "e911_ack_required", "not_implemented", "rate_limited"]) {
      const key = errorKeyFor(400, code);
      expect(fr[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(fr["account.rewardSoon"]).toMatch(/bientôt/);
    expect(toErrorKey(new ApiClientError(501, "not_implemented", "error.notImplemented", "x"))).toBe("error.notImplemented");
    expect(toErrorKey(new Error("x"))).toBe("error.generic");
  });
});
