import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { monthPeriod } from "../src/lib/time.js";
import { pushPayload } from "../src/services/webPush.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const OUT = "/webhooks/twilio/voice/outbound";
const IN = "/webhooks/twilio/voice/inbound";
const call = (userId: string, to: string, sid = "CA" + Math.random().toString(16).slice(2)) =>
  twilioPost(ctx, OUT, { CallSid: sid, From: `client:${userId}`, To: to });
const handle = (u: { auth: Record<string, string> }, h: string) =>
  ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: h } });
const rings = () => ctx.notifier.sent.filter((n) => (n as unknown[])[1] === "incoming_call");
const premium = (accountId: string) =>
  ctx.repo.upsertSubscription({
    telecomAccountId: accountId,
    kind: "plan",
    code: "premium",
    quantity: 1,
    stripeSubscriptionId: `sub_${accountId}`,
    status: "active",
    source: "stripe",
    currentPeriodEnd: null,
  });

describe("incoming call Web Push", () => {
  it("rings by @handle and the lock screen shows the handle, never a user id", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await handle(a, "camille");
    await handle(b, "jules");
    const res = await call(a.user.id, "@jules", "CAhandlePush");
    expect(res.body).toContain(`<Identity>${b.user.id}</Identity>`);
    expect(rings()).toEqual([[b.user.id, "incoming_call", { from: "@camille" }]]);
    const payload = pushPayload("incoming_call", { from: "@camille", text: "secret" }, "fr-CA")!;
    expect(payload).toMatchObject({ title: "Appel entrant", body: "@camille", url: "/appels", ttl: 60 });
    expect(JSON.stringify(payload)).not.toContain(a.user.id);
    expect(JSON.stringify(payload)).not.toContain(b.user.id);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("does not notify when a handle call is refused, blocked, or out of minutes", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await handle(b, "jules");
    expect((await call(a.user.id, "@nobody")).body).not.toContain("<Client>");
    expect((await call(a.user.id, "@jules")).body).not.toContain("<Client>");
    await handle(a, "camille");
    await ctx.repo.callControls.addBlock({ telecomAccountId: b.account.id, e164: "@camille", label: null });
    expect((await call(a.user.id, "@jules")).body).not.toContain("<Client>");

    const c = await makeUser(ctx);
    const d = await makeUser(ctx);
    await handle(c, "alice");
    await handle(d, "bob");
    // 120 free on-net minutes + the 30 bonus minutes of the « Choisissez votre @nom » mission, all used.
    await ctx.repo.addUsage(c.account.id, [monthPeriod(new Date())], { minutesOnNet: 150 });
    expect((await call(c.user.id, "@bob")).body).toContain("minutes d'appels entre applications");
    expect((await call(c.user.id, "@bob")).body).not.toContain("<Client>");
    expect(rings()).toEqual([]);
  });

  it("rings a MIMT number in-app and shows an E.164, or the caller's @handle when they have no number", async () => {
    const a = await makeUser(ctx, { number: "+15145550100" });
    const b = await makeUser(ctx, { number: "+15145550101" });
    const res = await call(a.user.id, "5145550101", "CAnum1");
    expect(res.body).toContain(`<Client>${b.user.id}</Client>`);
    expect(rings()).toEqual([[b.user.id, "incoming_call", { from: "+15145550100" }]]);
    const shown = pushPayload("incoming_call", { from: "+15145550100" }, "en-CA")!;
    expect(shown.body).toBe("+15145550100");
    expect(JSON.stringify(shown)).not.toContain(a.user.id);

    const c = await makeUser(ctx);
    await handle(c, "camille");
    const byHandle = await call(c.user.id, "+15145550101", "CAnum2");
    expect(byHandle.body).toContain(`<Client>${b.user.id}</Client>`);
    expect(rings().at(-1)).toEqual([b.user.id, "incoming_call", { from: "@camille" }]);

    const anon = await makeUser(ctx);
    const bare = await call(anon.user.id, "+15145550101", "CAnum3");
    expect(bare.body).toContain(`<Client>${b.user.id}</Client>`);
    expect(rings().at(-1)).toEqual([b.user.id, "incoming_call", {}]);
    const hidden = pushPayload("incoming_call", { from: `client:${anon.user.id}` }, "fr-CA")!;
    expect(hidden.body).toBe("");
    expect(JSON.stringify(hidden)).not.toContain(anon.user.id);
  });

  it("rings from the phone network with the caller's E.164", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await premium(u.account.id);
    const res = await twilioPost(ctx, IN, { CallSid: "CApstn", From: "+14165550123", To: "+15145550100" });
    expect(res.body).toContain(`<Client>${u.user.id}</Client>`);
    expect(rings()).toEqual([[u.user.id, "incoming_call", { from: "+14165550123" }]]);
    expect(pushPayload("incoming_call", { from: "+14165550123" }, "fr-CA")!.body).toBe("+14165550123");
  });

  it("does not notify on refuse, block, forward, or voicemail", async () => {
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    expect((await call(u.user.id, "911", "CA911")).body).toContain("<Number>911</Number>");
    // A call that leaves for the phone network is not an incoming call on an app.
    await premium(u.account.id);
    expect((await call(u.user.id, "+14165550123", "CApstnOut")).body).toContain("<Number>+14165550123</Number>");
    expect(rings()).toEqual([]);
    // A free account has no inbound minutes, so the phone network goes straight to voicemail.
    await makeUser(ctx, { number: "+15145550102" });
    const vm = await twilioPost(ctx, IN, { CallSid: "CAvm", From: "+14165550123", To: "+15145550102" });
    expect(vm.body).toContain("<Record");
    expect(vm.body).not.toContain("<Client>");

    await ctx.repo.callControls.addBlock({ telecomAccountId: u.account.id, e164: "+14165550123", label: null });
    const rejected = await twilioPost(ctx, IN, { CallSid: "CAblock", From: "+14165550123", To: "+15145550100" });
    expect(rejected.body).toContain("<Reject");
    await ctx.app.inject({ method: "PATCH", url: "/v1/me", headers: u.auth, payload: { blockedCallAction: "voicemail" } });
    const blockedVm = await twilioPost(ctx, IN, { CallSid: "CAblockvm", From: "+14165550123", To: "+15145550100" });
    expect(blockedVm.body).toContain("<Record");

    await ctx.app.inject({ method: "PATCH", url: "/v1/me", headers: u.auth, payload: { dnd: { enabled: true } } });
    await premium(u.account.id);
    const dnd = await twilioPost(ctx, IN, { CallSid: "CAdnd", From: "+14165550999", To: "+15145550100" });
    expect(dnd.body).toContain("<Record");

    await ctx.app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: u.auth,
      payload: { dnd: { enabled: false }, forwarding: { mode: "always", target: "+14385550147" } },
    });
    const forwarded = await twilioPost(ctx, IN, { CallSid: "CAfwd", From: "+14165550999", To: "+15145550100" });
    expect(forwarded.body).toContain("<Number>+14385550147</Number>");
    expect(forwarded.body).not.toContain("<Client>");
    expect(rings()).toEqual([]);
  });

  it("notifies once when the app rings, including before a no-answer forward", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await premium(u.account.id);
    await ctx.app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: u.auth,
      payload: { forwarding: { mode: "no_answer", target: "+14385550147", timeoutS: 10 } },
    });
    const callRes = await twilioPost(ctx, IN, { CallSid: "CAna", From: "+14165550123", To: "+15145550100" });
    expect(callRes.body).toContain(`<Client>${u.user.id}</Client>`);
    expect(rings()).toHaveLength(1);
    const action = /action="([^"]+)"/.exec(callRes.body)![1]!.replace(/&amp;/g, "&").replace("https://api.test.mimt.ca", "");
    const fwd = await twilioPost(ctx, action, { CallSid: "CAna", DialCallStatus: "no-answer" });
    expect(fwd.body).toContain("<Number>+14385550147</Number>");
    expect(rings()).toHaveLength(1);
  });
});
