import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeUser, setup as baseSetup, type Ctx, LEGACY_FREE } from "./helpers.js";

// These tests predate launch pricing: their free users hold a phone-network number (LEGACY_FREE).
const setup = (o: Parameters<typeof baseSetup>[0] = {}) => baseSetup({ ...o, config: { ...LEGACY_FREE, ...o.config } });

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const claim = (auth: Record<string, string>, e164 = "+15145550199") =>
  ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: auth, payload: { e164 } });

describe("number claim", () => {
  it("is refused without a 9-1-1 address", async () => {
    const u = await makeUser(ctx, { e911: false, ack: true });
    const res = await claim(u.auth);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("e911_address_required");
    expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();
  });

  it("is refused without the current 9-1-1 acknowledgement", async () => {
    const u = await makeUser(ctx, { e911: true, ack: false });
    expect((await claim(u.auth)).json().error).toBe("e911_ack_required");
  });

  it("requires a confirmed device for a free number when that rule is on", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { DEVICE_ATTESTATION_REQUIRED: "true" } });
    const u = await makeUser(ctx, { e911: true, ack: true });
    const res = await claim(u.auth);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("device_attestation_required");
    expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();
  });

  it("is refused without phone or device verification", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true, verified: false });
    expect((await claim(u.auth)).json().error).toBe("verification_required");
  });

  it("buys the number with our webhooks and the emergency address, then announces it to TAKATAK", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    const res = await claim(u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ e164: "+15145550199", state: "active" });
    expect(ctx.twilio!.purchaseNumber).toHaveBeenCalledWith({
      e164: "+15145550199",
      voiceUrl: "https://api.test.mimt.ca/webhooks/twilio/voice/inbound",
      smsUrl: "https://api.test.mimt.ca/webhooks/twilio/sms/inbound",
      statusCallback: "https://api.test.mimt.ca/webhooks/twilio/voice/status",
      emergencyAddressSid: "ADtest",
    });
    expect(ctx.repo.outbox.map((e) => e.eventType)).toContain("phone_number.assigned");
  });

  it("allows one number on the free plan", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true, number: "+15145550100" });
    expect((await claim(u.auth)).json().error).toBe("number_limit_reached");
  });

  it("never hands out a quarantined number", async () => {
    const old = await makeUser(ctx, { number: "+15145550199" });
    await ctx.repo.updateNumber(old.number!.id, { state: "quarantine" });
    const u = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(u.auth)).json().error).toBe("number_unavailable");
    const search = await ctx.app.inject({ url: "/v1/numbers/available?areaCode=514", headers: u.auth });
    expect(search.json().numbers).toEqual([]);
  });

  it("lists available numbers (default Quebec area codes)", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ url: "/v1/numbers/available", headers: u.auth });
    expect(res.json()).toMatchObject({ areaCode: "514", numbers: [{ e164: "+15145550199" }] });
  });
});
