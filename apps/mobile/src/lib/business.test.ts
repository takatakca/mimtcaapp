import { DEFAULT_RECORDING_POLICY, type BusinessResponse, type Extension } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { businessLines, outboundParams } from "./business";

const biz = (id: string, mainNumber: string | null): BusinessResponse => ({
  business: {
    id,
    name: `Biz ${id}`,
    takatakBusinessId: null,
    telecomAccountId: `acc-${id}`,
    mainNumber,
    locale: "fr-CA",
    recordingPolicy: DEFAULT_RECORDING_POLICY,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  role: "member",
  seats: 3,
});

const ext = (businessId: string, number: string, userId: string | null, did: string | null = null): Extension => ({
  id: `${businessId}-${number}`,
  businessId,
  number,
  userId,
  displayName: number,
  voicemail: { enabled: true, greeting: null },
  forwardToMobile: null,
  did,
  ringTimeoutS: 20,
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("businessLines", () => {
  it("finds my extension and prefers its direct number as caller ID", () => {
    const lines = businessLines(
      [biz("a", "+15145550100"), biz("b", "+14385550100"), biz("c", null)],
      {
        a: [ext("a", "101", "other"), ext("a", "102", "me", "+15145550102")],
        b: [ext("b", "200", "me")],
        c: [],
      },
      "me",
    );
    expect(lines).toEqual([
      { businessId: "a", name: "Biz a", role: "member", extension: "102", mainNumber: "+15145550100", callerId: "+15145550102" },
      { businessId: "b", name: "Biz b", role: "member", extension: "200", mainNumber: "+14385550100", callerId: "+14385550100" },
      { businessId: "c", name: "Biz c", role: "member", extension: null, mainNumber: null, callerId: null },
    ]);
  });

  it("has no extension without a signed-in user", () => {
    expect(businessLines([biz("a", null)], { a: [ext("a", "101", "me")] }, null)[0]!.extension).toBeNull();
  });
});

describe("outboundParams", () => {
  it("asks the API for the business caller ID", () => {
    expect(outboundParams("+15145550123", "+15145550100")).toEqual({ To: "+15145550123", CallerId: "+15145550100" });
    expect(outboundParams("+15145550123")).toEqual({ To: "+15145550123" });
    expect(outboundParams("+15145550123", null)).toEqual({ To: "+15145550123" });
  });

  it("9-1-1 always goes out as an emergency call, never with a business caller ID", () => {
    expect(outboundParams("911", "+15145550100")).toEqual({ To: "911", Emergency: "true" });
    expect(outboundParams("911")).toEqual({ To: "911", Emergency: "true" });
  });
});
