import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeUser, NOTICE, setup, twilioPost, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

describe("/v1/me", () => {
  it("returns the MeResponse shape", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true, globalUserId: "gu_1" });
    const res = await ctx.app.inject({ url: "/v1/me", headers: u.auth });
    expect(res.json()).toMatchObject({
      user: { id: u.user.id, globalUserId: "gu_1", locale: "fr-CA" },
      account: { id: u.account.id, kind: "consumer", plan: "free" },
      numbers: [{ e164: "+15145550100", state: "active" }],
      e911: { addressRegistered: true, noticeAccepted: true, noticeVersion: NOTICE },
      usage: { outboundMinutes: 0, inboundMinutes: 0, outboundSms: 0 },
    });
  });

  it("updates locale and display name, records consents", async () => {
    const u = await makeUser(ctx);
    const patch = await ctx.app.inject({ method: "PATCH", url: "/v1/me", headers: u.auth, payload: { locale: "en-CA", displayName: "Jo" } });
    expect(patch.json()).toMatchObject({ locale: "en-CA", displayName: "Jo" });
    const consent = await ctx.app.inject({
      method: "POST", url: "/v1/consents", headers: u.auth, payload: { kind: "ads_personalised", granted: false, version: "2026-10" },
    });
    expect(consent.statusCode).toBe(201);
    expect(await ctx.repo.listConsents(u.user.id)).toHaveLength(1);
  });

  it("exports the user's data with decrypted messages (Law 25 portability)", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: "SM1", From: "+15145550199", To: "+15145550100", Body: "coucou" });
    const res = await ctx.app.inject({ url: "/v1/me/export", headers: u.auth });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.format).toBe("mimt-export-v1");
    expect(data.messages[0].body).toBe("coucou");
    expect(JSON.stringify(data)).not.toContain("bodyEncrypted");
  });

  it("schedules deletion, quarantines numbers and closes the account", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: u.auth });
    expect(res.statusCode).toBe(202);
    expect((await ctx.repo.getUser(u.user.id))!.status).toBe("pending_deletion");
    const n = (await ctx.repo.getNumber(u.number!.id))!;
    expect(n.state).toBe("quarantine");
    expect(n.quarantineUntil!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect((await ctx.repo.getAccount(u.account.id))!.status).toBe("CLOSED");
  });
});

describe("health and plumbing", () => {
  it("serves healthz/readyz and CORS for allowed origins only", async () => {
    expect((await ctx.app.inject({ url: "/healthz" })).json()).toEqual({ ok: true });
    expect((await ctx.app.inject({ url: "/readyz" })).json()).toMatchObject({ ok: true, db: "up" });
    const allowed = await ctx.app.inject({ url: "/healthz", headers: { origin: "https://app.mimt.ca" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.mimt.ca");
    const denied = await ctx.app.inject({ url: "/healthz", headers: { origin: "https://evil.example" } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects an empty in-app receipt and stays unconfigured without store credentials", async () => {
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/billing/iap/verify", headers: u.auth, payload: {} })).statusCode).toBe(400);
    const missing = await ctx.app.inject({
      method: "POST",
      url: "/v1/billing/iap/verify",
      headers: u.auth,
      payload: { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: "x".repeat(40) },
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json().error).toBe("not_configured");
  });

  it("answers 503 for billing without Stripe", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium" } });
    expect(res.statusCode).toBe(503);
  });
});
