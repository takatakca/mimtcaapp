import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { intlRateFor } from "@mimt/shared";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup as baseSetup, twilioPost, type Ctx, LEGACY_FREE } from "./helpers.js";

// These tests predate launch pricing: their free users hold a phone-network number (LEGACY_FREE).
const setup = (o: Parameters<typeof baseSetup>[0] = {}) => baseSetup({ ...o, config: { ...LEGACY_FREE, ...o.config } });

const OUT = "/webhooks/twilio/voice/outbound";
const IN = "/webhooks/twilio/voice/inbound";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const outbound = (userId: string, to: string, sid = "CA" + Math.random().toString(16).slice(2)) =>
  twilioPost(ctx, OUT, { CallSid: sid, From: `client:${userId}`, To: to });

describe("outbound voice: 9-1-1", () => {
  it("always dials 9-1-1, even with zero caps, no 9-1-1 ack and a suspended account", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: false, ack: false });
    await ctx.repo.updateAccount(u.account.id, { status: "SUSPENDED" });
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { minutesOut: 10_000, spendCad: 10_000 });
    // Exhaust the call-attempt rate limiter too.
    for (let i = 0; i < 20; i++) await ctx.deps.rateLimiter.take(`call:m:${u.account.id}`, { capacity: 6, windowSeconds: 60 });

    for (const dialed of ["911", "9-1-1", "+1911"]) {
      const res = await outbound(u.user.id, dialed);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<Dial callerId="+15145550100"><Number>911</Number></Dial>');
      expect(res.body).not.toContain("<Say");
    }
    const calls = [...ctx.repo.calls.values()];
    expect(calls.every((c) => c.kind === "emergency")).toBe(true);
  });

  it("dials 9-1-1 for an unknown identity with the fallback caller ID", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { EMERGENCY_FALLBACK_CALLER_ID: "+15145550000" } });
    const res = await outbound("nobody", "911");
    expect(res.body).toContain('<Dial callerId="+15145550000"><Number>911</Number></Dial>');
  });

  it("dials 9-1-1 even when the database fails", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    ctx.repo.getUser = async () => {
      throw new Error("db down");
    };
    const res = await outbound(u.user.id, "911");
    expect(res.body).toContain("<Number>911</Number>");
  });
});

describe("outbound voice: PSTN rules", () => {
  it("dials Canada/US with caller ID and a time limit from the remaining minutes", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    const res = await outbound(u.user.id, "(416) 555-0123");
    expect(res.body).toContain('<Dial callerId="+15145550100" timeLimit="1800" answerOnBridge="true"><Number>+14165550123</Number></Dial>');
  });

  it("halves minutes for new accounts", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true, ageDays: 2 });
    const res = await outbound(u.user.id, "+14165550123");
    expect(res.body).toContain('timeLimit="900"');
  });

  it("refuses PSTN calls without 9-1-1 address and acknowledgement (in French first)", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: false });
    const res = await outbound(u.user.id, "+14165550123");
    expect(res.body).toMatch(/<Say language="fr-CA">Avant d'appeler, enregistrez votre adresse 9-1-1/);
    expect(res.body).not.toContain("<Dial");
  });

  it("refuses when monthly minutes are used up", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { minutesOut: 30 });
    const res = await outbound(u.user.id, "+14165550123");
    expect(res.body).toContain("Vous avez utilisé toutes vos minutes");
    expect(res.body).not.toContain("<Dial");
  });

  it("refuses a second simultaneous call on the free plan", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await outbound(u.user.id, "+14165550123", "CA1");
    const res = await outbound(u.user.id, "+14165550124", "CA2");
    expect(res.body).toContain("déjà un appel en cours");
  });

  it("blocks international, premium-rate and Caribbean NANP destinations and logs fraud events", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    for (const to of ["+442071234567", "011442071234567", "+19005551234", "+14169765555", "+18765551234"]) {
      const res = await outbound(u.user.id, to);
      expect(res.body, to).toContain("n'est pas permise");
      expect(res.body).not.toContain("<Dial");
    }
    const events = await ctx.repo.listFraudEvents(u.account.id);
    expect(events.map((e) => e.rule)).toEqual(
      expect.arrayContaining(["destination_intl_not_allowed", "destination_premium_rate_blocked"]),
    );
  });

  it("refuses Cuba until the second carrier is connected, then dials that SIP trunk", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await ctx.repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_cu", status: "active", source: "stripe", currentPeriodEnd: null,
    });
    await ctx.repo.replaceEntitlements(u.account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
    await ctx.repo.addIntlCredit(u.account.id, 500);
    const blocked = await outbound(u.user.id, "+5355550100");
    expect(blocked.body).toContain("second fournisseur");
    expect(blocked.body).not.toContain("<Sip>");

    await ctx.app.close();
    ctx = await setup({ config: { CUBA_SIP_HOST: "sip.example.net", CUBA_CARRIER: "telnyx" } });
    const paid = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await ctx.repo.upsertSubscription({
      telecomAccountId: paid.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_cu2", status: "active", source: "stripe", currentPeriodEnd: null,
    });
    await ctx.repo.replaceEntitlements(paid.account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
    await ctx.repo.addIntlCredit(paid.account.id, 500);
    const res = await outbound(paid.user.id, "+5355550100");
    expect(res.body).toContain("<Sip>sip:5355550100@sip.example.net</Sip>");
    expect(res.body).not.toContain("<Number>+5355550100</Number>");
  });

  it("allows international with the entitlement and prepaid credit, limited by credit", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await ctx.repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_1", status: "active", source: "stripe", currentPeriodEnd: null,
    });
    await ctx.repo.replaceEntitlements(u.account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
    await ctx.repo.addIntlCredit(u.account.id, 500);
    const res = await outbound(u.user.id, "+442071234567");
    // 5,00 $ of credit at the UK retail rate (packages/shared/src/rates.ts) buys this many whole minutes.
    const minutes = Math.floor(500 / intlRateFor("+442071234567")!.centsPerMinute);
    expect(res.body).toContain(`timeLimit="${minutes * 60}"`);
    expect(res.body).toContain("<Number>+442071234567</Number>");
  });

  it("refuses outbound PSTN for a suspended account", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await ctx.repo.updateAccount(u.account.id, { status: "OUTBOUND_SUSPENDED" });
    const res = await outbound(u.user.id, "+14165550123");
    expect(res.body).toContain("suspendus");
  });

  it("connects app-to-app calls to the other user's client, without caps or 9-1-1 checks", async () => {
    const a = await makeUser(ctx, { number: "+15145550100" });
    const b = await makeUser(ctx, { number: "+15145550101" });
    await ctx.repo.addUsage(a.account.id, [monthPeriod(new Date())], { minutesOut: 10_000 });
    const res = await outbound(a.user.id, "5145550101");
    expect(res.body).toContain(`<Client>${b.user.id}</Client>`);
    expect(res.body).not.toContain("<Number>");
  });
});

describe("inbound voice", () => {
  it("rings the owner's app for 25 s, then sends unanswered calls to voicemail", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await twilioPost(ctx, IN, { CallSid: "CAin1", From: "+14165550123", To: "+15145550100" });
    expect(res.body).toContain('<Dial timeout="25" answerOnBridge="true"');
    expect(res.body).toContain(`<Client>${u.user.id}</Client>`);
    const action = /action="([^"]+)"/.exec(res.body)![1]!.replace(/&amp;/g, "&");
    const path = action.replace("https://api.test.mimt.ca", "");

    const noAnswer = await twilioPost(ctx, path, { CallSid: "CAin1", DialCallStatus: "no-answer" });
    expect(noAnswer.body).toContain('<Say language="fr-CA">Bonjour, vous avez joint la messagerie vocale');
    expect(noAnswer.body).toMatch(/<Record maxLength="120"/);
    expect(noAnswer.body).not.toContain("transcribe=");

    const answered = await twilioPost(ctx, path, { CallSid: "CAin1", DialCallStatus: "completed" });
    expect(answered.body).toContain("<Hangup/>");
    expect(answered.body).not.toContain("<Record");
  });

  it("transcribes voicemail only with the vm_transcription entitlement", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await ctx.repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_2", status: "active", source: "stripe", currentPeriodEnd: null,
    });
    const res = await twilioPost(ctx, `/webhooks/twilio/voice/dial-result?n=${u.number!.id}`, { DialCallStatus: "busy" });
    expect(res.body).toContain('transcribe="true"');
  });

  it("answers 'not in service' for a quarantined number", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await ctx.repo.updateNumber(u.number!.id, { state: "quarantine" });
    const res = await twilioPost(ctx, IN, { CallSid: "CAq", From: "+14165550123", To: "+15145550100" });
    expect(res.body).toContain("Ce numéro n'est plus en service.");
    expect(res.body).not.toContain("<Dial");
  });

  it("stores voicemail recordings and transcriptions", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await twilioPost(ctx, IN, { CallSid: "CAvm", From: "+14165550123", To: "+15145550100" });
    await twilioPost(ctx, `/webhooks/twilio/voice/recording?n=${u.number!.id}`, {
      CallSid: "CAvm", RecordingSid: "RE1", RecordingUrl: "https://api.twilio.com/rec/RE1", RecordingDuration: "12", RecordingStatus: "completed",
    });
    await twilioPost(ctx, "/webhooks/twilio/voice/transcription", { RecordingSid: "RE1", TranscriptionStatus: "completed", TranscriptionText: "hello" });
    const [vm] = await ctx.repo.listVoicemails(u.account.id);
    expect(vm).toMatchObject({ fromNumber: "+14165550123", durationS: 12, transcript: "hello" });
  });
});

describe("call status and spend guard", () => {
  it("rates completed calls into the usage ledger once", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await outbound(u.user.id, "+14165550123", "CAs1");
    const status = { CallSid: "CAs1", CallStatus: "completed", CallDuration: "61", Price: "-0.028", PriceUnit: "USD" };
    expect((await twilioPost(ctx, "/webhooks/twilio/voice/status", status)).statusCode).toBe(204);
    await twilioPost(ctx, "/webhooks/twilio/voice/status", status);
    const usage = await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()));
    expect(usage.minutesOut).toBe(2);
    expect(usage.spendCad).toBeCloseTo(0.028 * 1.4);
  });

  it("suspends outbound calling when daily spend exceeds the threshold", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await outbound(u.user.id, "+14165550123", "CAs2");
    await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: "CAs2", CallStatus: "completed", CallDuration: "600", Price: "-30", PriceUnit: "USD" });
    expect((await ctx.repo.getAccount(u.account.id))!.status).toBe("OUTBOUND_SUSPENDED");
    expect((await ctx.repo.listFraudEvents(u.account.id)).some((e) => e.rule === "daily_spend_guard" && e.action === "suspend")).toBe(true);
    expect(ctx.repo.outbox.some((e) => e.eventType === "telecom_account.status_changed")).toBe(true);
    // 9-1-1 still works after the suspension.
    expect((await outbound(u.user.id, "911")).body).toContain("<Number>911</Number>");
  });
});

describe("webhook signatures", () => {
  it("rejects a bad or missing X-Twilio-Signature with 403", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const params = { CallSid: "CAx", From: `client:${u.user.id}`, To: "911" };
    expect((await twilioPost(ctx, OUT, params, "bad-signature")).statusCode).toBe(403);
    const unsigned = await ctx.app.inject({
      method: "POST", url: OUT, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(params).toString(),
    });
    expect(unsigned.statusCode).toBe(403);
    // A signature for other params does not validate either.
    const sig = (await import("../src/gateways/twilio.js")).expectedTwilioSignature("test-twilio-auth-token", "https://api.test.mimt.ca" + OUT, { ...params, To: "+14165550123" });
    expect((await twilioPost(ctx, OUT, params, sig)).statusCode).toBe(403);
  });

  it("answers 503 when the Twilio auth token is not configured", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { TWILIO_AUTH_TOKEN: "" } });
    expect((await twilioPost(ctx, OUT, { To: "911" })).statusCode).toBe(503);
  });
});

describe("voice token", () => {
  it("issues a token for the user identity", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ url: "/v1/voice/token?platform=ios", headers: u.auth });
    expect(res.json()).toMatchObject({ token: `tok-${u.user.id}`, identity: u.user.id });
  });

  it("answers 503 not_configured without Twilio", async () => {
    await ctx.app.close();
    ctx = await setup({ twilio: null });
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ url: "/v1/voice/token", headers: u.auth });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("not_configured");
  });
});
