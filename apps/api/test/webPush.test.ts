import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCipher } from "../src/lib/crypto.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { INCOMING_CALL_TTL_S, lockScreenCaller, pushPayload, vapidKeys, WebPushNotifier } from "../src/services/webPush.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };

describe("Web Push service", () => {
  it("creates the VAPID pair once, stores it encrypted, returns the same pair after", async () => {
    const repo = new MemoryRepository();
    const cipher = new MessageCipher(MessageCipher.generateKey());
    const a = await vapidKeys(repo, cipher);
    const b = await vapidKeys(repo, cipher);
    expect(a).toEqual(b);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(repo.webPush.keys.get("vapid")).not.toContain(a.privateKey);
  });

  it("never puts message text in a notification", () => {
    const p = pushPayload("message_received", { from: "@camille", text: "secret" }, "fr-CA")!;
    expect(p).toEqual({ title: "Nouveau texto", body: "De @camille", url: "/messages/%40camille", tag: "msg:@camille" });
    expect(JSON.stringify(p)).not.toContain("secret");
  });

  it("incoming call: French or English title, /appels, 60s, and only an @handle or E.164 on the lock screen", () => {
    const userId = "11111111-2222-4333-8444-555555555555";
    expect(INCOMING_CALL_TTL_S).toBe(60);
    expect(lockScreenCaller("@camille")).toBe("@camille");
    expect(lockScreenCaller("+15145550100")).toBe("+15145550100");
    expect(lockScreenCaller(userId)).toBeNull();
    expect(lockScreenCaller(`client:${userId}`)).toBeNull();
    expect(lockScreenCaller("secret message")).toBeNull();

    const fr = pushPayload("incoming_call", { from: "@jules", text: "ne pas afficher", userId }, "fr-CA")!;
    expect(fr).toEqual({ title: "Appel entrant", body: "@jules", url: "/appels", tag: "call", ttl: 60 });
    const en = pushPayload("incoming_call", { from: "+15145550199" }, "en-CA")!;
    expect(en).toEqual({ title: "Incoming call", body: "+15145550199", url: "/appels", tag: "call", ttl: 60 });
    const hidden = pushPayload("incoming_call", { from: `client:${userId}`, text: "transcript" }, "fr-CA")!;
    expect(hidden.body).toBe("");
    expect(JSON.stringify(hidden)).not.toContain(userId);
    expect(JSON.stringify(hidden)).not.toContain("transcript");
  });

  it("sends to every subscription of the user and drops the ones the push service says are gone", async () => {
    const repo = new MemoryRepository();
    const cipher = new MessageCipher(MessageCipher.generateKey());
    const user = await repo.createUser({ globalUserId: null, locale: "en-CA", displayName: null });
    await repo.webPush.upsert({ userId: user.id, endpoint: SUB.endpoint, ...SUB.keys });
    await repo.webPush.upsert({ userId: user.id, endpoint: "https://updates.push.services.mozilla.com/gone", ...SUB.keys });
    const send = vi.fn(async (s: { endpoint: string }, _payload: string, _opts?: { TTL?: number }) => {
      if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    await new WebPushNotifier({ repo, cipher, log }, send as never).notify(user.id, "message_received", { from: "+15145550199" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0]![1])).toMatchObject({ title: "New text", body: "From +15145550199" });
    expect(send.mock.calls[0]![2]).toMatchObject({ TTL: 3600 });
    expect((await repo.webPush.listForUser(user.id)).map((s) => s.endpoint)).toEqual([SUB.endpoint]);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("5145550199");

    send.mockClear();
    await new WebPushNotifier({ repo, cipher, log }, send as never).notify(user.id, "incoming_call", {
      from: "@camille",
      text: "secret",
    });
    const sent = JSON.parse(send.mock.calls[0]![1]) as { body: string; ttl: number };
    expect(sent).toMatchObject({ title: "Incoming call", body: "@camille", url: "/appels", ttl: 60 });
    expect(send.mock.calls[0]![2]).toMatchObject({ TTL: 60 });
    expect(JSON.stringify(sent)).not.toContain("secret");
    expect(JSON.stringify(sent)).not.toContain(user.id);
  });
});

describe("Web Push routes and triggers", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(() => ctx.app.close());

  it("serves the public key and stores a subscription for the signed-in user", async () => {
    const key = (await ctx.app.inject({ url: "/v1/push/web/key" })).json();
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/push/web/subscribe", headers: u.auth, payload: SUB })).statusCode).toBe(204);
    expect((await ctx.repo.webPush.listForUser(u.user.id)).length).toBe(1);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/push/web/subscribe", payload: SUB })).statusCode).toBe(401);
    await ctx.app.inject({ method: "POST", url: "/v1/push/web/unsubscribe", headers: u.auth, payload: { endpoint: SUB.endpoint } });
    expect((await ctx.repo.webPush.listForUser(u.user.id)).length).toBe(0);
  });

  it("a handle-to-handle text notifies the recipient, sender only", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: a.auth, payload: { handle: "camille" } });
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: b.auth, payload: { handle: "jules" } });
    await ctx.app.inject({ method: "POST", url: "/v1/messages", headers: a.auth, payload: { to: "@jules", body: "Salut" } });
    expect(ctx.notifier.sent).toContainEqual([b.user.id, "message_received", { from: "@camille" }]);
  });
});
