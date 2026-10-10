import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WeeklySchedule } from "@mimt/shared";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

const IN = "/webhooks/twilio/voice/inbound";
const OUT = "/webhooks/twilio/voice/outbound";
const SMS_IN = "/webhooks/twilio/sms/inbound";
const MINE = "+15145550100";
const CALLER = "+14165550123";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const premium = (accountId: string) =>
  ctx.repo.upsertSubscription({
    telecomAccountId: accountId, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: `sub_${accountId}`, status: "active", source: "stripe", currentPeriodEnd: null,
  });
const block = (auth: Record<string, string>, number: string, label?: string) =>
  ctx.app.inject({ method: "POST", url: "/v1/blocks", headers: auth, payload: { number, ...(label ? { label } : {}) } });
const patchMe = (auth: Record<string, string>, payload: Record<string, unknown>) => ctx.app.inject({ method: "PATCH", url: "/v1/me", headers: auth, payload });
const actionPath = (body: string) => /action="([^"]+)"/.exec(body)![1]!.replace(/&amp;/g, "&").replace("https://api.test.mimt.ca", "");

describe("blocks: CRUD", () => {
  it("adds (idempotent), lists, and removes by id or by number", async () => {
    const u = await makeUser(ctx, { number: MINE });
    const first = await block(u.auth, "(416) 555-0123", "Télémarketing");
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ e164: CALLER, label: "Télémarketing" });
    expect((await block(u.auth, CALLER)).statusCode).toBe(200);
    await block(u.auth, "+15145550111");

    const list = await ctx.app.inject({ url: "/v1/blocks", headers: u.auth });
    expect(list.json().blocks.map((b: { e164: string }) => b.e164).sort()).toEqual([CALLER, "+15145550111"].sort());

    const del = await ctx.app.inject({ method: "DELETE", url: `/v1/blocks/${first.json().id}`, headers: u.auth });
    expect(del.statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/blocks/${first.json().id}`, headers: u.auth })).statusCode).toBe(404);
    const byNumber = await ctx.app.inject({ method: "DELETE", url: `/v1/blocks?number=${encodeURIComponent("514-555-0111")}`, headers: u.auth });
    expect(byNumber.statusCode).toBe(204);
    expect((await ctx.app.inject({ url: "/v1/blocks", headers: u.auth })).json().blocks).toEqual([]);
  });

  it("refuses 9-1-1 and invalid numbers, requires auth, and keeps lists per account", async () => {
    const u = await makeUser(ctx, { number: MINE });
    const other = await makeUser(ctx, { number: "+15145550200" });
    for (const n of ["911", "9-1-1", "+1911"]) {
      const res = await block(u.auth, n);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cannot_block_emergency");
    }
    expect((await block(u.auth, "12345")).json().error).toBe("invalid_number");
    expect((await ctx.app.inject({ url: "/v1/blocks" })).statusCode).toBe(401);

    const mine = (await block(u.auth, CALLER)).json();
    expect((await ctx.app.inject({ url: "/v1/blocks", headers: other.auth })).json().blocks).toEqual([]);
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/blocks/${mine.id}`, headers: other.auth })).statusCode).toBe(404);
  });
});

describe("blocks: inbound", () => {
  it("rejects calls from a blocked number without ringing or logging the call", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await block(u.auth, CALLER);
    const res = await twilioPost(ctx, IN, { CallSid: "CAb1", From: CALLER, To: MINE });
    expect(res.body).toContain('<Reject reason="busy"/>');
    expect(res.body).not.toContain("<Dial");
    expect(await ctx.repo.getCallBySid("CAb1")).toBeNull();

    // Other callers still ring.
    const ok = await twilioPost(ctx, IN, { CallSid: "CAb2", From: "+14165550999", To: MINE });
    expect(ok.body).toContain(`<Client>${u.user.id}</Client>`);
  });

  it("sends blocked callers to voicemail when the user prefers it", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await block(u.auth, CALLER);
    expect((await patchMe(u.auth, { blockedCallAction: "voicemail" })).json().callSettings.blockedCallAction).toBe("voicemail");
    const res = await twilioPost(ctx, IN, { CallSid: "CAb3", From: CALLER, To: MINE });
    expect(res.body).toContain("<Record");
    expect(res.body).not.toContain("<Client>");
  });

  it("drops texts from a blocked number: not stored, no notification", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await block(u.auth, CALLER);
    const res = await twilioPost(ctx, SMS_IN, { MessageSid: "SMb1", From: CALLER, To: MINE, Body: "allo" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<Message>");
    expect(ctx.repo.messages).toHaveLength(0);
    expect(ctx.notifier.sent).toHaveLength(0);
    // STOP from a blocked sender is still honoured.
    await twilioPost(ctx, SMS_IN, { From: CALLER, To: MINE, Body: "STOP" });
    expect(await ctx.repo.isOptedOut(MINE, CALLER)).toBe(true);
    // Unblocked senders still arrive.
    await twilioPost(ctx, SMS_IN, { MessageSid: "SMb2", From: "+14165550999", To: MINE, Body: "salut" });
    expect(ctx.repo.messages).toHaveLength(1);
  });

  it("never touches outbound 9-1-1, even with 9-1-1-like and own numbers on the list", async () => {
    const u = await makeUser(ctx, { number: MINE, e911: false, ack: false });
    await block(u.auth, CALLER);
    await ctx.repo.callControls.addBlock({ telecomAccountId: u.account.id, e164: "+1911", label: null }); // even if it got in somehow
    await patchMe(u.auth, { dnd: { enabled: true } });
    for (const dialed of ["911", "9-1-1"]) {
      const res = await twilioPost(ctx, OUT, { CallSid: `CA911${dialed}`, From: `client:${u.user.id}`, To: dialed });
      expect(res.body).toContain(`<Dial callerId="${MINE}"><Number>911</Number></Dial>`);
    }
  });
});

describe("call forwarding", () => {
  it("is gated by the call_forwarding plan feature", async () => {
    const u = await makeUser(ctx, { number: MINE });
    const res = await patchMe(u.auth, { forwarding: { mode: "always", target: "+14385550147" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("plan_required");
    // Turning it off is always allowed.
    expect((await patchMe(u.auth, { forwarding: { mode: "off" } })).statusCode).toBe(200);
  });

  it("'always' dials the target with the user's number as caller ID and counts the minutes", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await premium(u.account.id);
    const res = await patchMe(u.auth, { forwarding: { mode: "always", target: "438 555-0147" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().callSettings.forwarding).toEqual({ mode: "always", target: "+14385550147", timeoutS: 20 });
    expect((await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json().callSettings.forwarding.mode).toBe("always");

    const call = await twilioPost(ctx, IN, { CallSid: "CAf1", From: CALLER, To: MINE });
    expect(call.body).toMatch(new RegExp(`<Dial callerId="\\${MINE}" timeout="25" timeLimit="14400" answerOnBridge="true"`));
    expect(call.body).toContain("<Number>+14385550147</Number>");
    expect(call.body).not.toContain("<Client>");

    const path = actionPath(call.body);
    expect(path).toContain("fw=1");
    const done = { CallSid: "CAf1", DialCallSid: "CAchild1", DialCallStatus: "completed", DialCallDuration: "61" };
    expect((await twilioPost(ctx, path, done)).body).toContain("<Hangup/>");
    await twilioPost(ctx, path, done); // retried webhook: counted once
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).minutesOut).toBe(2);

    // Inbound leg is counted by the normal status callback.
    await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: "CAf1", CallStatus: "completed", CallDuration: "70" });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).minutesIn).toBe(2);

    // Unanswered forward goes to voicemail.
    const missed = await twilioPost(ctx, path, { CallSid: "CAf2", DialCallStatus: "no-answer" });
    expect(missed.body).toContain("<Record");
  });

  it("'no_answer' rings the apps for the chosen time, then forwards", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await premium(u.account.id);
    await patchMe(u.auth, { forwarding: { mode: "no_answer", target: "+14385550147", timeoutS: 10 } });
    const call = await twilioPost(ctx, IN, { CallSid: "CAn1", From: CALLER, To: MINE });
    expect(call.body).toContain('<Dial timeout="10" answerOnBridge="true"');
    expect(call.body).toContain(`<Client>${u.user.id}</Client>`);
    const fwd = await twilioPost(ctx, actionPath(call.body), { CallSid: "CAn1", DialCallStatus: "no-answer" });
    expect(fwd.body).toContain(`callerId="${MINE}"`);
    expect(fwd.body).toContain("<Number>+14385550147</Number>");
    // Answered on the app: no forwarding.
    expect((await twilioPost(ctx, actionPath(call.body), { CallSid: "CAn1", DialCallStatus: "completed" })).body).toContain("<Hangup/>");
  });

  it("refuses fraud-blocked and unsafe destinations", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await premium(u.account.id);
    await makeUser(ctx, { number: "+15145550200" });
    for (const [target, reason] of [
      ["+19005550123", "premium_rate_blocked"],
      ["+18765550123", "intl_not_allowed"],
      ["+33612345678", "intl_not_allowed"],
      ["911", "emergency_not_allowed"],
      ["+15145550200", "mimt_number_not_allowed"],
    ] as const) {
      const res = await patchMe(u.auth, { forwarding: { mode: "always", target } });
      expect(res.statusCode, target).toBe(400);
      expect(res.json()).toMatchObject({ error: "forwarding_destination_not_allowed", message: reason });
    }
    expect((await ctx.repo.listFraudEvents(u.account.id)).some((e) => e.rule === "forwarding_premium_rate_blocked")).toBe(true);
    expect((await patchMe(u.auth, { forwarding: { mode: "always" } })).json().error).toBe("forwarding_target_required");
    expect((await ctx.repo.callControls.getCallSettings(u.account.id)).forwarding.mode).toBe("off");
  });

  it("falls back to ringing the apps when the plan lapses or outbound minutes run out", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await premium(u.account.id);
    await patchMe(u.auth, { forwarding: { mode: "always", target: "+14385550147" } });
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { minutesOut: 10_000 });
    let call = await twilioPost(ctx, IN, { CallSid: "CAl1", From: CALLER, To: MINE });
    expect(call.body).toContain(`<Client>${u.user.id}</Client>`);

    const u2 = await makeUser(ctx, { number: "+15145550300" });
    await ctx.repo.callControls.saveCallSettings(u2.account.id, {
      forwarding: { mode: "always", target: "+14385550147", timeoutS: 20 },
      dnd: { enabled: false, schedule: null },
      blockedCallAction: "reject",
    }); // free plan: stored setting must not forward
    call = await twilioPost(ctx, IN, { CallSid: "CAl2", From: CALLER, To: "+15145550300" });
    expect(call.body).not.toContain("<Number>");
  });
});

describe("do not disturb", () => {
  it("sends calls straight to voicemail while on, and rings again when off", async () => {
    const u = await makeUser(ctx, { number: MINE });
    expect((await patchMe(u.auth, { dnd: { enabled: true } })).json().callSettings.dnd).toEqual({ enabled: true, schedule: null });
    const res = await twilioPost(ctx, IN, { CallSid: "CAd1", From: CALLER, To: MINE });
    expect(res.body).toContain("Bonjour, vous avez joint la messagerie vocale");
    expect(res.body).not.toContain("<Client>");
    expect((await ctx.repo.getCallBySid("CAd1"))?.direction).toBe("inbound");

    await patchMe(u.auth, { dnd: { enabled: false } });
    expect((await twilioPost(ctx, IN, { CallSid: "CAd2", From: CALLER, To: MINE })).body).toContain("<Client>");
  });

  it("follows quiet hours in Montreal time, overnight ranges included", async () => {
    let now = new Date("2026-10-12T23:30:00-04:00"); // Monday night
    await ctx.app.close();
    ctx = await setup({ now: () => now });
    const u = await makeUser(ctx, { number: MINE });
    const nights: WeeklySchedule = { mon: [{ open: "22:00", close: "07:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    expect((await patchMe(u.auth, { dnd: { enabled: true, schedule: nights } })).statusCode).toBe(200);
    expect((await twilioPost(ctx, IN, { CallSid: "CAq1", From: CALLER, To: MINE })).body).toContain("<Record");
    now = new Date("2026-10-13T08:00:00-04:00");
    expect((await twilioPost(ctx, IN, { CallSid: "CAq2", From: CALLER, To: MINE })).body).toContain("<Client>");
  });

  it("validates schedules and wins over forwarding", async () => {
    const u = await makeUser(ctx, { number: MINE });
    await premium(u.account.id);
    const bad = await patchMe(u.auth, { dnd: { enabled: true, schedule: { mon: [{ open: "25:00", close: "07:00" }] } } });
    expect(bad.statusCode).toBe(400);
    await patchMe(u.auth, { forwarding: { mode: "always", target: "+14385550147" }, dnd: { enabled: true } });
    const res = await twilioPost(ctx, IN, { CallSid: "CAd3", From: CALLER, To: MINE });
    expect(res.body).toContain("<Record");
    expect(res.body).not.toContain("<Number>");
  });
});
