import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { monthPeriod } from "../src/lib/time.js";
import { LEGACY_FREE, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

// Free-tier cost guard (src/services/freeTier.ts).
const OUT = "/webhooks/twilio/voice/outbound";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup({ config: LEGACY_FREE });
});
afterEach(() => ctx.app.close());

async function restart(config: Record<string, string>) {
  await ctx.app.close();
  ctx = await setup({ config: { ...LEGACY_FREE, ...config } });
}

const claim = (auth: Record<string, string>, e164 = "+15145550199") =>
  ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: auth, payload: { e164 } });
const outbound = (userId: string, to: string) =>
  twilioPost(ctx, OUT, { CallSid: "CA" + Math.random().toString(16).slice(2), From: `client:${userId}`, To: to });
const send = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/messages", headers: auth, payload });

async function subscribe(accountId: string, code: string, kind: "plan" | "addon" = "plan") {
  await ctx.repo.upsertSubscription({
    telecomAccountId: accountId,
    kind,
    code,
    quantity: 1,
    stripeSubscriptionId: `sub_${code}_${accountId}`,
    status: "active",
    source: "stripe",
    currentPeriodEnd: null,
  });
}

/** Puts the free tier's month at `cad` of estimated spend, through an unrelated free account. */
async function spendFree(cad: number) {
  const other = await makeUser(ctx);
  await ctx.repo.addUsage(other.account.id, [monthPeriod(new Date())], { spendCad: cad });
}

describe("free-tier cost guard: new free numbers per day", () => {
  it("refuses a free claim with 409 free_quota_reached once today's cap is used", async () => {
    await restart({ FREE_NEW_NUMBERS_PER_DAY: "1" });
    const first = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(first.auth)).statusCode).toBe(201);

    const second = await makeUser(ctx, { e911: true, ack: true });
    const res = await claim(second.auth, "+15145550198");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("free_quota_reached");
    expect(res.json().message).toMatch(/^Les numéros gratuits du jour sont tous attribués\..*Essentiel \(12,99 \$\) ou Premium/);
    expect(ctx.twilio!.purchaseNumber).toHaveBeenCalledTimes(1);
  });

  it("counts only today's free claims (UTC)", async () => {
    await restart({ FREE_NEW_NUMBERS_PER_DAY: "1" });
    const u = await makeUser(ctx);
    await ctx.repo.audit({ actorUserId: u.user.id, action: "number.claimed", meta: { plan: "free" }, at: new Date(Date.now() - 2 * 86_400_000) });
    await ctx.repo.audit({ actorUserId: u.user.id, action: "number.claimed", meta: { plan: "premium" } });
    const v = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(v.auth)).statusCode).toBe(201);
  });

  it("refuses every free claim when the cap is 0 or free signups are off", async () => {
    for (const config of [{ FREE_NEW_NUMBERS_PER_DAY: "0" }, { FREE_SIGNUPS_ENABLED: "false" }] as Record<string, string>[]) {
      await restart(config);
      const u = await makeUser(ctx, { e911: true, ack: true });
      const res = await claim(u.auth);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("free_quota_reached");
      expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();
    }
  });

  it("lets paid plans claim numbers past the cap", async () => {
    await restart({ FREE_NEW_NUMBERS_PER_DAY: "0", FREE_SIGNUPS_ENABLED: "false" });
    for (const plan of ["lock", "premium"]) {
      const u = await makeUser(ctx, { e911: true, ack: true });
      await subscribe(u.account.id, plan);
      const res = await claim(u.auth, plan === "lock" ? "+15145550198" : "+15145550197");
      expect(res.statusCode).toBe(201);
    }
  });

  it("refuses a free claim once FREE_ACTIVE_NUMBERS_MAX free numbers are held; paid plans bypass it", async () => {
    await restart({ FREE_ACTIVE_NUMBERS_MAX: "2", FREE_NEW_NUMBERS_PER_DAY: "100" });
    await makeUser(ctx, { number: "+15145550101" });
    await makeUser(ctx, { number: "+15145550102" });
    const u = await makeUser(ctx, { e911: true, ack: true });
    const res = await claim(u.auth);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("free_quota_reached");
    expect(res.json().message).toMatch(/^Les numéros gratuits du jour sont tous attribués/);
    expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();

    await subscribe(u.account.id, "lock");
    expect((await claim(u.auth)).statusCode).toBe(201);
  });

  it("does not count released or quarantined numbers, nor numbers of paid accounts, toward the total cap", async () => {
    await restart({ FREE_ACTIVE_NUMBERS_MAX: "1", FREE_NEW_NUMBERS_PER_DAY: "100" });
    const a = await makeUser(ctx, { number: "+15145550101" });
    const b = await makeUser(ctx, { number: "+15145550102" });
    const paid = await makeUser(ctx, { number: "+15145550103" });
    await subscribe(paid.account.id, "premium");
    await ctx.repo.updateNumber(a.number!.id, { state: "released" });
    await ctx.repo.updateNumber(b.number!.id, { state: "quarantine" });
    const u = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(u.auth)).statusCode).toBe(201);
    // Now one free number is held: the next free claim is refused.
    const v = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(v.auth, "+15145550198")).json().error).toBe("free_quota_reached");
  });

  it("refuses every free claim when FREE_ACTIVE_NUMBERS_MAX is 0", async () => {
    await restart({ FREE_ACTIVE_NUMBERS_MAX: "0" });
    const u = await makeUser(ctx, { e911: true, ack: true });
    expect((await claim(u.auth)).statusCode).toBe(409);
  });

  it("still checks 9-1-1 before the quota", async () => {
    await restart({ FREE_NEW_NUMBERS_PER_DAY: "0" });
    const u = await makeUser(ctx, { e911: false, ack: true });
    expect((await claim(u.auth)).json().error).toBe("e911_address_required");
  });
});

describe("free-tier cost guard: monthly budget and outbound switch", () => {
  it("refuses free outbound PSTN calls in French first once the budget is reached", async () => {
    await restart({ FREE_TIER_MONTHLY_BUDGET_CAD: "150" });
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    expect((await outbound(u.user.id, "5145550199")).body).toContain("<Number>+15145550199</Number>");

    await spendFree(150);
    const res = await outbound(u.user.id, "5145550199");
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<Dial");
    expect(res.body.indexOf('language="fr-CA"')).toBeLessThan(res.body.indexOf('language="en-CA"'));
    expect(res.body).toContain("forfait gratuit");
    expect(res.body).toContain("<Hangup");
    expect((await ctx.repo.listFraudEvents(u.account.id)).map((e) => e.rule)).toContain("free_budget_reached");
  });

  it("counts outbound SMS segments of free accounts toward the budget", async () => {
    await restart({ FREE_TIER_MONTHLY_BUDGET_CAD: "1" });
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    const other = await makeUser(ctx);
    await ctx.repo.addUsage(other.account.id, [monthPeriod(new Date())], { smsOut: 44 }); // 44 × 0,023 $ = 1,01 $
    expect((await outbound(u.user.id, "5145550199")).body).not.toContain("<Dial");
  });

  it("ignores the spend of paid accounts", async () => {
    await restart({ FREE_TIER_MONTHLY_BUDGET_CAD: "10" });
    const paid = await makeUser(ctx);
    await subscribe(paid.account.id, "premium");
    await ctx.repo.addUsage(paid.account.id, [monthPeriod(new Date())], { spendCad: 500 });
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    expect((await outbound(u.user.id, "5145550199")).body).toContain("<Number>+15145550199</Number>");
  });

  it("refuses free outbound PSTN calls when FREE_OUTBOUND_PSTN_ENABLED=false", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false" });
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    const res = await outbound(u.user.id, "5145550199");
    expect(res.body).not.toContain("<Dial");
    expect((await ctx.repo.listFraudEvents(u.account.id)).map((e) => e.rule)).toContain("free_outbound_disabled");
  });

  it("keeps app-to-app calls allowed with the budget reached and outbound off", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false", FREE_TIER_MONTHLY_BUDGET_CAD: "0" });
    const a = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    const b = await makeUser(ctx, { number: "+15145550101" });
    const res = await outbound(a.user.id, "5145550101");
    expect(res.body).toContain(`<Client>${b.user.id}</Client>`);
  });

  it("lets Number Lock and Premium call the phone network with the budget reached", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false", FREE_TIER_MONTHLY_BUDGET_CAD: "1" });
    await spendFree(5);
    for (const [i, plan] of (["lock", "premium"] as const).entries()) {
      const u = await makeUser(ctx, { number: `+1514555010${i}`, e911: true, ack: true });
      await subscribe(u.account.id, plan);
      expect((await outbound(u.user.id, "5145550199")).body).toContain("<Number>+15145550199</Number>");
    }
  });

  it("always dials 9-1-1 for a free user with the budget exhausted and outbound disabled", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false", FREE_TIER_MONTHLY_BUDGET_CAD: "0", FREE_NEW_NUMBERS_PER_DAY: "0", FREE_SIGNUPS_ENABLED: "false" });
    await spendFree(10_000);
    const u = await makeUser(ctx, { number: "+15145550100", e911: false, ack: false });
    for (const dialed of ["911", "9-1-1", "+1911"]) {
      const res = await outbound(u.user.id, dialed);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<Dial callerId="+15145550100"><Number>911</Number></Dial>');
      expect(res.body).not.toContain("<Say");
    }
  });

  it("refuses free outbound SMS with a French message, but keeps texts to MIMT numbers and paid plans", async () => {
    await restart({ FREE_TIER_MONTHLY_BUDGET_CAD: "5" });
    const u = await makeUser(ctx, { number: "+15145550100" });
    await makeUser(ctx, { number: "+15145550101" });
    await spendFree(5);

    const refused = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "Salut" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("free_budget_reached");
    expect(refused.json().message).toMatch(/^Les appels et textos vers le réseau téléphonique sont en pause/);
    expect(ctx.twilio!.sendMessage).not.toHaveBeenCalled();

    expect((await send(u.auth, { from: "+15145550100", to: "+15145550101", body: "Salut" })).statusCode).toBe(201);

    const paid = await makeUser(ctx, { number: "+15145550102" });
    await subscribe(paid.account.id, "premium");
    expect((await send(paid.auth, { from: "+15145550102", to: "+15145550199", body: "Salut" })).statusCode).toBe(201);
  });

  it("refuses free outbound SMS when FREE_OUTBOUND_PSTN_ENABLED=false", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false" });
    const u = await makeUser(ctx, { number: "+15145550100" });
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "Salut" })).json().error).toBe("free_outbound_disabled");
  });

  it("does not touch inbound calls", async () => {
    await restart({ FREE_OUTBOUND_PSTN_ENABLED: "false", FREE_TIER_MONTHLY_BUDGET_CAD: "0" });
    const u = await makeUser(ctx, { number: "+15145550100" });
    const res = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAin", From: "+15145550199", To: "+15145550100" });
    expect(res.body).toContain(`<Client>${u.user.id}</Client>`);
  });
});

describe("GET /v1/admin/costs", () => {
  it("requires a signed-in MIMT admin", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/costs" })).statusCode).toBe(401);
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/costs", headers: u.auth });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("admin_only");
  });

  it("reports the month, free spend, budget and today's free numbers", async () => {
    await restart({ FREE_NEW_NUMBERS_PER_DAY: "7", FREE_TIER_MONTHLY_BUDGET_CAD: "150", FREE_ACTIVE_NUMBERS_MAX: "40" });
    await makeUser(ctx, { number: "+15145550101" });
    await makeUser(ctx, { number: "+15145550102" });
    await makeUser(ctx, { number: "+15145550103" });
    const staff = await makeUser(ctx);
    // The allowlist is read per request (same mechanism as the catalog admin routes).
    ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(staff.user.id);
    await spendFree(12.5);
    const other = await makeUser(ctx);
    await ctx.repo.addUsage(other.account.id, [monthPeriod(new Date())], { smsOut: 10 });
    await ctx.repo.audit({ actorUserId: null, action: "number.claimed", meta: { plan: "free" } });
    await ctx.repo.audit({ actorUserId: null, action: "number.claimed", meta: { plan: "free" } });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/costs", headers: staff.auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({
      month: monthPeriod(new Date()),
      freeSpendCad: 12.73,
      budgetCad: 150,
      budgetReached: false,
      outboundEnabled: true,
      freeNumbersToday: 2,
      capToday: 7,
      activeFreeNumbers: 3,
      activeFreeMax: 40,
      estimatedFixedMonthlyCad: 7.92,
      signupsEnabled: true,
    });
  });
});
