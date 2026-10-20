import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup as baseSetup, twilioPost, type Ctx, LEGACY_FREE } from "./helpers.js";

// These tests predate launch pricing: their free users hold a phone-network number (LEGACY_FREE).
const setup = (o: Parameters<typeof baseSetup>[0] = {}) => baseSetup({ ...o, config: { ...LEGACY_FREE, ...o.config } });

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const send = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/messages", headers: auth, payload });

describe("sending SMS", () => {
  it("sends from an owned number and stores the body encrypted", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await send(u.auth, { from: "+15145550100", to: "514-555-0199", body: "Salut, ça va?" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ peer: "+15145550199", body: "Salut, ça va?", direction: "outbound" });
    const stored = ctx.repo.messages[0]!;
    expect(stored.bodyEncrypted).not.toContain("Salut");
    expect(ctx.deps.cipher.decrypt(stored.bodyEncrypted)).toBe("Salut, ça va?");
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).smsOut).toBe(1);
  });

  it("refuses numbers the user does not own and non-NANP destinations", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await makeUser(ctx, { number: "+15145550101" });
    expect((await send(u.auth, { from: "+15145550101", to: "+15145550199", body: "x" })).json().error).toBe("not_your_number");
    expect((await send(u.auth, { from: "+15145550100", to: "+33612345678", body: "x" })).json().error).toBe("destination_not_allowed");
    expect((await send(u.auth, { from: "+15145550100", to: "+18765551234", body: "x" })).json().error).toBe("destination_not_allowed");
  });

  it("enforces the monthly message cap, texts sent and received", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { smsOut: 60, smsIn: 40 });
    const res = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "hello" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("sms_quota_exhausted");
  });

  it("blocks bulk-identical sends to many recipients", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    for (const to of ["+15145550191", "+15145550192", "+15145550193"]) {
      expect((await send(u.auth, { from: "+15145550100", to, body: "Promo  incroyable!" })).statusCode).toBe(201);
    }
    const res = await send(u.auth, { from: "+15145550100", to: "+15145550194", body: "promo incroyable!" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("bulk_identical_blocked");
    expect((await ctx.repo.listFraudEvents(u.account.id))[0]?.rule).toBe("sms_bulk_identical");
  });

  it("limits first-time recipients per hour (halved for new accounts)", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", ageDays: 1 });
    for (let i = 0; i < 5; i++) {
      expect((await send(u.auth, { from: "+15145550100", to: `+1514555020${i}`, body: `msg ${i}` })).statusCode).toBe(201);
    }
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550299", body: "msg x" })).json().error).toBe("new_recipient_limit");
  });

  it("blocks OTP-shaped texts from free accounts", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "Your verification code is 482913" });
    expect(res.json().error).toBe("otp_content_blocked");
  });

  it("requires the MMS entitlement for media", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "pic", mediaUrls: ["https://cdn.mimt.ca/a.jpg"] });
    expect(res.json().error).toBe("mms_not_in_plan");
  });
});

describe("opt-out keywords", () => {
  for (const keyword of ["STOP", "arrêt", "ARRET", "Unsubscribe", "désabonner"]) {
    it(`honours "${keyword}" for that (number, sender) pair`, async () => {
      const u = await makeUser(ctx, { number: "+15145550100" });
      const inbound = await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: "SMin", From: "+15145550199", To: "+15145550100", Body: keyword });
      expect(inbound.statusCode).toBe(200);
      expect(await ctx.repo.isOptedOut("+15145550100", "+15145550199")).toBe(true);
      const res = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "hello?" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("recipient_opted_out");
    });
  }

  it("START opts back in", async () => {
    await makeUser(ctx, { number: "+15145550100" });
    await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { From: "+15145550199", To: "+15145550100", Body: "STOP" });
    await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { From: "+15145550199", To: "+15145550100", Body: "start" });
    expect(await ctx.repo.isOptedOut("+15145550100", "+15145550199")).toBe(false);
  });
});

describe("inbound SMS and conversations", () => {
  it("stores inbound messages encrypted and pages conversations with a cursor", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    for (let i = 0; i < 5; i++) {
      await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: `SM${i}`, From: "+15145550199", To: "+15145550100", Body: `bonjour ${i}` });
    }
    const conv = await ctx.app.inject({ url: "/v1/conversations", headers: u.auth });
    expect(conv.json().conversations).toHaveLength(1);

    const peer = encodeURIComponent("+15145550199");
    const page1 = (await ctx.app.inject({ url: `/v1/conversations/${peer}/messages?limit=3`, headers: u.auth })).json();
    expect(page1.messages).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await ctx.app.inject({ url: `/v1/conversations/${peer}/messages?limit=3&cursor=${page1.nextCursor}`, headers: u.auth })).json();
    expect(page2.messages).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.messages, ...page2.messages].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("replies 'not in service' to texts sent to a quarantined number", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await ctx.repo.updateNumber(u.number!.id, { state: "quarantine" });
    const res = await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { From: "+15145550199", To: "+15145550100", Body: "allo" });
    expect(res.body).toContain("<Message>Ce numéro n'est plus en service.");
    expect(ctx.repo.messages).toHaveLength(0);
  });

  it("rejects unsigned SMS webhooks", async () => {
    const res = await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { From: "+15145550199", To: "+15145550100", Body: "x" }, "nope");
    expect(res.statusCode).toBe(403);
  });
});
