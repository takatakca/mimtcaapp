import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const setHandle = (auth: Record<string, string>, handle: string) => ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: auth, payload: { handle } });
const send = (auth: Record<string, string>, to: string, body = "Salut!") => ctx.app.inject({ method: "POST", url: "/v1/messages", headers: auth, payload: { to, body } });

describe("MIMT handles", () => {
  it("lets a user pick one handle, once, normalised", async () => {
    const a = await makeUser(ctx);
    expect((await ctx.app.inject({ url: "/v1/me/handle", headers: a.auth })).json()).toEqual({ handle: null });
    expect((await setHandle(a.auth, "Camille.T")).json()).toMatchObject({ handle: "@camille.t", missionGranted: { id: "choose_handle" } });
    expect((await setHandle(a.auth, "camille.t")).json()).toEqual({ handle: "@camille.t" });
    expect((await setHandle(a.auth, "camille.t")).statusCode).toBe(200);
    expect((await setHandle(a.auth, "autre")).json().error).toBe("handle_already_set");
  });

  it("refuses taken, reserved and malformed handles", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await setHandle(a.auth, "camille");
    expect((await setHandle(b.auth, "@Camille")).json().error).toBe("handle_taken");
    expect((await setHandle(b.auth, "mimt")).json().error).toBe("handle_taken");
    expect((await setHandle(b.auth, "a b")).json().error).toBe("invalid_handle");
  });

  it("looks up a handle without revealing who it is", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await setHandle(a.auth, "camille");
    expect((await ctx.app.inject({ url: "/v1/handles/camille", headers: b.auth })).json()).toEqual({ handle: "@camille", exists: true });
    expect((await ctx.app.inject({ url: "/v1/handles/personne", headers: b.auth })).json()).toEqual({ handle: "@personne", exists: false });
  });
});

describe("handle-to-handle texts", () => {
  it("work on the free plan without any phone number, never touch the carrier and cost nothing", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await setHandle(a.auth, "camille");
    await setHandle(b.auth, "jules");
    const sent = await send(a.auth, "@jules", "Tu viens samedi?");
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ direction: "outbound", ourNumber: "@camille", peer: "@jules", body: "Tu viens samedi?", status: "delivered" });
    expect(ctx.twilio!.sendMessage).not.toHaveBeenCalled();

    const convs = (await ctx.app.inject({ url: "/v1/conversations", headers: b.auth })).json().conversations;
    expect(convs).toEqual([expect.objectContaining({ peer: "@camille", ourNumber: "@jules" })]);
    const thread = (await ctx.app.inject({ url: `/v1/conversations/${encodeURIComponent("@camille")}/messages`, headers: b.auth })).json();
    expect(thread.messages[0]).toMatchObject({ direction: "inbound", body: "Tu viens samedi?" });

    const usage = await ctx.repo.getUsage(a.account.id, new Date().toISOString().slice(0, 7));
    expect(usage.smsOut).toBe(0);
  });

  it("needs your own handle and an existing recipient", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    expect((await send(a.auth, "@jules")).json().error).toBe("handle_required");
    await setHandle(a.auth, "camille");
    expect((await send(a.auth, "@jules")).json().error).toBe("handle_not_found");
    await setHandle(b.auth, "jules");
    expect((await send(a.auth, "@camille")).json().error).toBe("cannot_text_yourself");
  });

  it("respects the recipient's block list without telling the sender", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await setHandle(a.auth, "camille");
    await setHandle(b.auth, "jules");
    await ctx.repo.callControls.addBlock({ telecomAccountId: b.account.id, e164: "@camille", label: null });
    expect((await send(a.auth, "@jules")).statusCode).toBe(201);
    expect((await ctx.app.inject({ url: "/v1/conversations", headers: b.auth })).json().conversations).toEqual([]);
  });

  it("is rate limited like texts", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    await setHandle(a.auth, "camille");
    await setHandle(b.auth, "jules");
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await send(a.auth, "@jules", `message ${i}`)).statusCode;
    expect(last).toBe(429);
  });

  it("still requires `from` for a text to a phone number", async () => {
    const a = await makeUser(ctx, { number: "+15145550100" });
    expect((await send(a.auth, "+15145550199")).json().error).toBe("from_required");
  });
});
