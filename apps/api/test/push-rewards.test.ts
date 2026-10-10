import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const APNS = "a".repeat(64);

describe("POST /v1/push/register", () => {
  it("stores the device token per user and platform, idempotently", async () => {
    const u = await makeUser(ctx);
    const payload = { token: APNS, platform: "ios", kind: "messages" };
    expect((await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: u.auth, payload })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: u.auth, payload })).statusCode).toBe(204);
    expect(await ctx.repo.listPushTokens(u.user.id)).toMatchObject([{ token: APNS, platform: "ios", kind: "messages" }]);
  });

  it("moves a token to the user who registers it last (shared device, new sign-in)", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const payload = { token: "fcm:token-123", platform: "android", kind: "messages" };
    await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: a.auth, payload });
    await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: b.auth, payload });
    expect(await ctx.repo.listPushTokens(a.user.id)).toEqual([]);
    expect(await ctx.repo.listPushTokens(b.user.id)).toHaveLength(1);
  });

  it("requires a session and validates the body", async () => {
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/push/register", payload: { token: APNS, platform: "ios" } })).statusCode).toBe(401);
    for (const payload of [{ token: APNS, platform: "web" }, { token: "", platform: "ios" }, { token: "has spaces in it", platform: "ios" }, { platform: "ios" }]) {
      const res = await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: u.auth, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    }
  });

  it("drops the user's push tokens when the account is deleted", async () => {
    const u = await makeUser(ctx);
    await ctx.app.inject({ method: "POST", url: "/v1/push/register", headers: u.auth, payload: { token: APNS, platform: "ios", kind: "messages" } });
    expect((await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: u.auth })).statusCode).toBe(202);
    expect(await ctx.repo.listPushTokens(u.user.id)).toEqual([]);
  });
});

describe("POST /v1/rewards/claim", () => {
  it("does not credit minutes until AdMob's signed callback has arrived", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({
      method: "POST", url: "/v1/rewards/claim", headers: u.auth, payload: { kind: "rewarded_ad_10min", adUnitId: "ca-app-pub-x/y" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("reward_pending");
    expect(res.json().message).toMatch(/pas encore arrivée/);
    const usage = [...ctx.repo.usage.values()];
    expect(usage.every((x) => x.bonusMinutesOut === 0)).toBe(true);
  });

  it("requires a session and a valid body", async () => {
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/rewards/claim", payload: { kind: "rewarded_ad_10min", adUnitId: "x" } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/rewards/claim", headers: u.auth, payload: { kind: "free_money" } })).statusCode).toBe(400);
  });
});
