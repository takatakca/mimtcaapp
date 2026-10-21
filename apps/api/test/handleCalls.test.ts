import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const OUT = "/webhooks/twilio/voice/outbound";
const call = (userId: string, to: string, sid = "CA" + Math.random().toString(16).slice(2)) => twilioPost(ctx, OUT, { CallSid: sid, From: `client:${userId}`, To: to });
const handle = (u: { auth: Record<string, string> }, h: string) => ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: h } });

describe("calls by MIMT handle", () => {
  it("ring the other user's app with the caller's handle, without any phone number", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await handle(a, "camille");
    await handle(b, "jules");
    const res = await call(a.user.id, "@jules", "CAhandle1");
    expect(res.body).toContain("<Identity>" + b.user.id + "</Identity>");
    expect(res.body).toContain('<Parameter name="fromHandle" value="@camille"/>');
    expect(res.body).toMatch(/timeLimit="\d+"/);
    const calls = await ctx.repo.listCalls(a.account.id, 5);
    expect(calls[0]).toMatchObject({ kind: "app", fromNumber: "@camille", toNumber: "@jules" });
  });

  it("refuses without your own handle, unknown handles and yourself", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await handle(b, "jules");
    expect((await call(a.user.id, "@jules")).body).toContain("identifiant MIMT");
    await handle(a, "camille");
    expect((await call(a.user.id, "@personne")).body).toContain("n'est pas valide");
    expect((await call(a.user.id, "@camille")).body).toContain("n'est pas valide");
  });

  it("respects the callee's block list", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await handle(a, "camille");
    await handle(b, "jules");
    await ctx.repo.callControls.addBlock({ telecomAccountId: b.account.id, e164: "@camille", label: null });
    const res = await call(a.user.id, "@jules");
    expect(res.body).not.toContain("<Client>");
    expect(res.body).toContain("ne peut pas recevoir");
  });

  it("9-1-1 still goes first", async () => {
    const a = await makeUser(ctx, { e911: true, ack: true });
    const res = await call(a.user.id, "911");
    expect(res.body).toContain("911");
    expect(res.body).not.toContain("identifiant");
  });
});
