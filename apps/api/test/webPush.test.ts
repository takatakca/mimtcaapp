import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCipher } from "../src/lib/crypto.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { pushPayload, vapidKeys, WebPushNotifier } from "../src/services/webPush.js";
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

  it("sends to every subscription of the user and drops the ones the push service says are gone", async () => {
    const repo = new MemoryRepository();
    const cipher = new MessageCipher(MessageCipher.generateKey());
    const user = await repo.createUser({ globalUserId: null, locale: "en-CA", displayName: null });
    await repo.webPush.upsert({ userId: user.id, endpoint: SUB.endpoint, ...SUB.keys });
    await repo.webPush.upsert({ userId: user.id, endpoint: "https://updates.push.services.mozilla.com/gone", ...SUB.keys });
    const send = vi.fn(async (s: { endpoint: string }, _payload: string) => {
      if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    await new WebPushNotifier({ repo, cipher, log }, send as never).notify(user.id, "message_received", { from: "+15145550199" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0]![1])).toMatchObject({ title: "New text", body: "From +15145550199" });
    expect((await repo.webPush.listForUser(user.id)).map((s) => s.endpoint)).toEqual([SUB.endpoint]);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("5145550199");
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
