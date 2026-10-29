// « MIMT Connect » (docs/MIMT-CONNECT.md): partner keys, members, hunt groups, credits, the PBX hooks and the
// signed webhook outbox. Repository rules (memory + Postgres): partners.repo.contract.test.ts.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliverPartnerWebhooks, WEBHOOK_MAX_ATTEMPTS } from "../src/services/partners.js";
import { BASE_URL, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";

let ctx: Ctx;
let now: Date;
beforeEach(async () => {
  now = new Date("2026-10-29T15:00:00Z");
  ctx = await setup({ config: { PARTNERS: "on", PARTNER_CREDIT_PER_MINUTE: "2" }, now: () => now });
});
afterEach(() => ctx.app.close());

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const advance = (s: number) => (now = new Date(now.getTime() + s * 1000));

const silentLog = { warn: () => undefined, error: () => undefined };

/** A business-plan business made a partner by an admin, with one API key. */
async function makePartner(opts: { plan?: "business" | "business_pro" } = {}) {
  const biz = await makeBusiness(ctx, opts.plan ? { plan: opts.plan } : {});
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  const created = await call("POST", "/v1/admin/partners", admin.auth, { businessId: biz.business.id });
  expect(created.statusCode).toBe(201);
  const partnerId = created.json().id as string;
  const k = await call("POST", `/v1/admin/partners/${partnerId}/keys`, admin.auth, { label: "besoinavocat prod" });
  expect(k.statusCode).toBe(201);
  return { ...biz, admin, partnerId, key: k.json().key as string, keyId: k.json().apiKey.id as string };
}

async function setWebhook(p: Awaited<ReturnType<typeof makePartner>>, url = "https://hooks.besoinavocat.test/mimt") {
  const res = await call("PUT", `/v1/admin/partners/${p.partnerId}/webhook`, p.admin.auth, { url });
  expect(res.statusCode).toBe(200);
  return res.json().secret as string;
}

const topUp = (p: Awaited<ReturnType<typeof makePartner>>, credits: number, key = `topup-${credits}-${Math.random().toString(36).slice(2)}`) =>
  call("POST", `/v1/admin/partners/${p.partnerId}/credits`, p.admin.auth, { credits, idempotencyKey: key });

/** Two lawyers (app member via @handle is covered elsewhere; here: mobile forwarding) and the hunt group on the DID. */
async function lawyersAndHunt(p: Awaited<ReturnType<typeof makePartner>>, strategy: "simultaneous" | "sequential" = "simultaneous") {
  const h = bearer(p.key);
  expect((await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", phone: "+15145550142", language: "fr" })).statusCode).toBe(201);
  expect((await call("PUT", "/v1/partner/members/avocat-7", h, { name: "Me Roy", phone: "+15145550107" })).statusCode).toBe(201);
  const hunt = await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", h, {
    name: "Trouver un avocat",
    members: ["avocat-42", "avocat-7"],
    strategy,
    ringTimeoutS: 25,
    did: p.didNumber.e164,
  });
  expect(hunt.statusCode).toBe(201);
  return hunt.json();
}

/** Inbound PSTN call to the partner DID; returns the TwiML. */
const ring = (p: Awaited<ReturnType<typeof makePartner>>, sid: string) =>
  twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: sid, From: "+14385550199", To: p.didNumber.e164 });

/** Mobile leg of a member: press 1 on the whisper (x = the member's extension id). */
async function answerOnMobile(p: Awaited<ReturnType<typeof makePartner>>, parentSid: string, externalId: string, legSid: string) {
  const m = await ctx.repo.partners.getMember((await ctx.repo.partners.getPartner(p.partnerId))!.id, externalId);
  const path = `/webhooks/twilio/pbx/whisper-input?b=${p.business.id}&x=${m!.extensionId}`;
  return twilioPost(ctx, path, { CallSid: legSid, ParentCallSid: parentSid, Digits: "1" });
}

const legCompleted = async (p: Awaited<ReturnType<typeof makePartner>>, parentSid: string, externalId: string, legSid: string, duration: number) => {
  const m = await ctx.repo.partners.getMember(p.partnerId, externalId);
  return twilioPost(ctx, `/webhooks/twilio/pbx/leg?b=${p.business.id}&x=${m!.extensionId}`, {
    CallSid: legSid,
    ParentCallSid: parentSid,
    CallStatus: "completed",
    CallDuration: String(duration),
  });
};
const parentEnded = (sid: string, duration: number) =>
  twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: sid, CallStatus: "completed", CallDuration: String(duration) });

const events = (type?: string) => ctx.repo.partners.events.filter((e) => !type || e.eventType === type);

// ---------------------------------------------------------------------------------------------- kill switch

describe("partners: kill switch", () => {
  it("PARTNERS=off answers 404 on every partner, admin and owner route, authenticated or not", async () => {
    const off = await setup({ now: () => now });
    try {
      const u = await makeUser(off);
      off.deps.config.CATALOG_ADMIN_USER_IDS.push(u.user.id);
      const id = "00000000-0000-4000-8000-000000000000";
      const routes: Array<[Method, string, Record<string, string>]> = [
        ["GET", "/v1/partner/members", {}],
        ["GET", "/v1/partner/members", bearer("mimt_pk_whatever")],
        ["PUT", "/v1/partner/members/avocat-1", bearer("mimt_pk_whatever")],
        ["GET", "/v1/partner/calls", {}],
        ["GET", "/v1/partner/credits", {}],
        ["GET", "/v1/admin/partners", u.auth],
        ["POST", "/v1/admin/partners", u.auth],
        ["POST", `/v1/admin/partners/${id}/credits`, u.auth],
        ["GET", `/v1/business/${id}/partner`, u.auth],
      ];
      for (const [method, url, headers] of routes) {
        const res = await off.app.inject({ method, url, headers, ...(method === "GET" ? {} : { payload: {} }) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error).toBe("not_found");
      }
      expect(off.deps.config.PARTNERS).toBe("off");
    } finally {
      await off.app.close();
    }
  });

  it("with PARTNERS=off a partner business's calls are routed exactly as before (no leg callbacks, no record)", async () => {
    const p = await makePartner();
    await lawyersAndHunt(p);
    ctx.deps.config.PARTNERS = "off";
    const twiml = (await ring(p, "CAoff1")).body;
    expect(twiml).toContain("+15145550142");
    expect(twiml).not.toContain("/pbx/leg");
    expect(await ctx.repo.partners.getCallBySid("CAoff1")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ API keys

describe("partners: API keys", () => {
  it("authenticates with the key shown once; only its hash and prefix are stored", async () => {
    const p = await makePartner();
    expect(p.key).toMatch(/^mimt_pk_[A-Za-z0-9_-]{43}$/);
    const stored = ctx.repo.partners.keys.find((k) => k.id === p.keyId)!;
    expect(stored.prefix).toBe(p.key.slice(0, 14));
    expect(stored.keySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ctx.repo.partners.keys)).not.toContain(p.key);
    expect(JSON.stringify(ctx.repo.auditLog)).not.toContain(p.key);

    const ok = await call("GET", "/v1/partner/members", bearer(p.key));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ members: [] });
    expect(ctx.repo.partners.keys.find((k) => k.id === p.keyId)!.lastUsedAt).not.toBeNull();
    // The admin view lists the key without its secret.
    const view = (await call("GET", `/v1/admin/partners/${p.partnerId}`, p.admin.auth)).json();
    expect(view.apiKeys).toEqual([expect.objectContaining({ id: p.keyId, prefix: stored.prefix, label: "besoinavocat prod", revokedAt: null })]);
    expect(JSON.stringify(view)).not.toContain(p.key);
  });

  it("refuses a missing, malformed, unknown or user-session token", async () => {
    const p = await makePartner();
    for (const headers of [{}, bearer("nope"), bearer(`mimt_pk_${"x".repeat(43)}`), p.owner.auth]) {
      const res = await call("GET", "/v1/partner/members", headers);
      expect(res.statusCode).toBe(401);
    }
  });

  it("revoke: the key stops working at once; rotate: new key works, old one does not", async () => {
    const p = await makePartner();
    const rotated = await call("POST", `/v1/admin/partners/${p.partnerId}/keys/${p.keyId}/rotate`, p.admin.auth);
    expect(rotated.statusCode).toBe(201);
    const fresh = rotated.json().key as string;
    expect(fresh).not.toBe(p.key);
    expect((await call("GET", "/v1/partner/members", bearer(p.key))).json().error).toBe("invalid_api_key");
    expect((await call("GET", "/v1/partner/members", bearer(fresh))).statusCode).toBe(200);

    const revoke = await call("DELETE", `/v1/admin/partners/${p.partnerId}/keys/${rotated.json().apiKey.id}`, p.admin.auth);
    expect(revoke.statusCode).toBe(204);
    expect((await call("GET", "/v1/partner/members", bearer(fresh))).statusCode).toBe(401);
    // Already revoked: 404, nothing changes.
    expect((await call("DELETE", `/v1/admin/partners/${p.partnerId}/keys/${p.keyId}`, p.admin.auth)).statusCode).toBe(404);
    const actions = ctx.repo.auditLog.filter((a) => a.targetId === p.partnerId).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["partner.created", "partner.key_created", "partner.key_revoked"]));
  });

  it("the business owner manages keys from the webphone routes; members and strangers cannot", async () => {
    const p = await makePartner();
    const res = await call("POST", `/v1/business/${p.business.id}/partner/keys`, p.owner.auth, { label: "webphone" });
    expect(res.statusCode).toBe(201);
    expect((await call("GET", "/v1/partner/members", bearer(res.json().key))).statusCode).toBe(200);
    const overview = await call("GET", `/v1/business/${p.business.id}/partner`, p.owner.auth);
    expect(overview.json().apiKeys).toHaveLength(2);
    expect((await call("GET", `/v1/business/${p.business.id}/partner`, p.staff.auth)).statusCode).toBe(403);
    expect((await call("GET", `/v1/business/${p.business.id}/partner`, (await makeUser(ctx)).auth)).statusCode).toBe(404);
  });

  it("a suspended partner is refused; admin routes are admin only", async () => {
    const p = await makePartner();
    expect((await call("GET", "/v1/admin/partners", p.owner.auth)).statusCode).toBe(403);
    await call("PATCH", `/v1/admin/partners/${p.partnerId}`, p.admin.auth, { status: "suspended" });
    const res = await call("GET", "/v1/partner/members", bearer(p.key));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("partner_suspended");
  });

  it("one partner per business", async () => {
    const p = await makePartner();
    expect((await call("POST", "/v1/admin/partners", p.admin.auth, { businessId: p.business.id })).statusCode).toBe(409);
  });
});

// ------------------------------------------------------------------------------------------------- members

describe("partners: members", () => {
  it("PUT is an idempotent upsert mapped to one extension of the business PBX", async () => {
    const p = await makePartner();
    const h = bearer(p.key);
    const body = { name: "Me Tremblay", email: "tremblay@cabinet.test", phone: "+15145550142", language: "fr" };
    const first = await call("PUT", "/v1/partner/members/avocat-42", h, body);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ externalId: "avocat-42", name: "Me Tremblay", active: true, extension: "2000", phone: "+15145550142" });
    const extsBefore = await ctx.repo.pbx.listExtensions(p.business.id);

    const again = await call("PUT", "/v1/partner/members/avocat-42", h, body);
    expect(again.statusCode).toBe(200);
    expect(again.json().extension).toBe("2000");
    expect(await ctx.repo.pbx.listExtensions(p.business.id)).toHaveLength(extsBefore.length);
    expect(ctx.repo.partners.members).toHaveLength(1);

    const ext = extsBefore.find((e) => e.number === "2000")!;
    expect(ext).toMatchObject({ displayName: "Me Tremblay", forwardToMobile: "+15145550142", userId: null });

    // An update moves the extension with it; a second member gets the next free number.
    await call("PUT", "/v1/partner/members/avocat-42", h, { ...body, phone: "+15145550143" });
    expect((await ctx.repo.pbx.getExtension(ext.id))!.forwardToMobile).toBe("+15145550143");
    expect((await call("PUT", "/v1/partner/members/avocat-7", h, { name: "Me Roy" })).json().extension).toBe("2001");
    expect((await call("GET", "/v1/partner/members", h)).json().members.map((m: { externalId: string }) => m.externalId)).toEqual(["avocat-42", "avocat-7"]);
  });

  it("DELETE deactivates: history kept, the extension rings nobody", async () => {
    const p = await makePartner();
    const h = bearer(p.key);
    await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", phone: "+15145550142" });
    const res = await call("DELETE", "/v1/partner/members/avocat-42", h);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ active: false, phone: "+15145550142", extension: "2000" });
    const ext = (await ctx.repo.pbx.listExtensions(p.business.id)).find((e) => e.number === "2000")!;
    expect(ext.forwardToMobile).toBeNull();
    expect((await call("DELETE", "/v1/partner/members/nobody", h)).statusCode).toBe(404);
  });

  it("a @handle must be an active member of the business; premium or foreign phones are refused", async () => {
    const p = await makePartner();
    const h = bearer(p.key);
    await ctx.repo.handles.create({ handle: "@metremblay", userId: p.staff.user.id, telecomAccountId: p.staff.account.id });
    const stranger = await makeUser(ctx);
    await ctx.repo.handles.create({ handle: "@inconnu", userId: stranger.user.id, telecomAccountId: stranger.account.id });

    const ok = await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", handle: "@MeTremblay" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().handle).toBe("@metremblay");
    const ext = (await ctx.repo.pbx.listExtensions(p.business.id)).find((e) => e.number === "2000")!;
    expect(ext.userId).toBe(p.staff.user.id);

    expect((await call("PUT", "/v1/partner/members/x", h, { name: "X", handle: "@inconnu" })).json().error).toBe("handle_not_member");
    expect((await call("PUT", "/v1/partner/members/x", h, { name: "X", handle: "@personne" })).json().error).toBe("unknown_handle");
    expect((await call("PUT", "/v1/partner/members/x", h, { name: "X", phone: "+19005550100" })).statusCode).toBe(400);
    expect((await call("PUT", "/v1/partner/members/bad%20id", h, { name: "X" })).statusCode).toBe(400);
    expect((await call("PUT", "/v1/partner/members/x", h, { name: "X", extra: 1 })).statusCode).toBe(400);
  });
});

// --------------------------------------------------------------------------------------------- hunt groups

describe("partners: hunt groups", () => {
  it("maps onto one ring group (members in order, strategy, timeout, fallback) and routes the DID to it", async () => {
    const p = await makePartner();
    const hunt = await lawyersAndHunt(p, "sequential");
    expect(hunt).toEqual({
      key: "trouver-un-avocat",
      name: "Trouver un avocat",
      members: ["avocat-42", "avocat-7"],
      strategy: "sequential",
      ringTimeoutS: 25,
      fallback: "voicemail",
      did: p.didNumber.e164,
    });
    const mapping = ctx.repo.partners.huntGroups[0]!;
    const group = (await ctx.repo.pbx.getRingGroup(mapping.ringGroupId))!;
    const m42 = (await ctx.repo.partners.getMember(p.partnerId, "avocat-42"))!;
    const m7 = (await ctx.repo.partners.getMember(p.partnerId, "avocat-7"))!;
    expect(group).toMatchObject({ businessId: p.business.id, strategy: "sequential", timeoutS: 25, overflow: null, memberExtensionIds: [m42.extensionId, m7.extensionId] });
    expect((await ctx.repo.pbx.getDidRouteByE164(p.didNumber.e164))!.target).toEqual({ type: "ring_group", ringGroupId: group.id });

    // Updated in place: same ring group, new order, hang up instead of voicemail.
    const h = bearer(p.key);
    const upd = await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", h, { members: ["avocat-7", "avocat-42"], strategy: "simultaneous", fallback: "hangup" });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ members: ["avocat-7", "avocat-42"], strategy: "simultaneous", fallback: "hangup", ringTimeoutS: 20 });
    expect((await ctx.repo.pbx.listRingGroups(p.business.id)).filter((g) => g.id === group.id)).toHaveLength(1);
    expect((await ctx.repo.pbx.getRingGroup(group.id))!.overflow).toEqual({ type: "hangup" });
    expect((await call("GET", "/v1/partner/hunt-groups", h)).json().huntGroups).toHaveLength(1);
  });

  it("refuses unknown members and numbers the business does not hold", async () => {
    const p = await makePartner();
    const h = bearer(p.key);
    const res = await call("PUT", "/v1/partner/hunt-groups/g1", h, { members: ["ghost"], strategy: "simultaneous" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_member");
    expect((await call("PUT", "/v1/partner/hunt-groups/g1", h, { members: [], strategy: "simultaneous", did: "+15145559999" })).json().error).toBe("number_not_in_business");
    expect((await call("PUT", "/v1/partner/hunt-groups/Bad%20Key", h, { members: [], strategy: "simultaneous" })).statusCode).toBe(400);
  });
});

// --------------------------------------------------------------------------------------- calls and credits

describe("partners: call lifecycle and credits", () => {
  it("ringing → answered by a lawyer → completed: events, per-started-minute debit, call record", async () => {
    const p = await makePartner();
    await setWebhook(p);
    await lawyersAndHunt(p);
    expect((await topUp(p, 100)).json()).toMatchObject({ duplicate: false, balance: 100 });

    const twiml = (await ring(p, "CA1")).body;
    // Mobile legs report completion to the leg webhook; their answer is the whisper press-1 (x = extension).
    expect(twiml).toContain(`${BASE_URL}/webhooks/twilio/pbx/leg?b=${p.business.id}`);
    expect(twiml).toMatch(/whisper\?b=[^"]+&amp;x=/);
    expect(events("call.ringing")).toHaveLength(1);
    expect(events("call.ringing")[0]!.payload).toMatchObject({ hunt_group: "trouver-un-avocat", from: "+14385550199", to: p.didNumber.e164 });
    await ring(p, "CA1"); // Twilio retry: still one record, one event.
    expect(events("call.ringing")).toHaveLength(1);

    advance(5);
    await answerOnMobile(p, "CA1", "avocat-7", "CAleg7");
    await answerOnMobile(p, "CA1", "avocat-42", "CAleg42"); // too late: the first answer wins
    expect(events("call.answered")).toHaveLength(1);
    expect(events("call.answered")[0]!.payload).toMatchObject({ member_external_id: "avocat-7" });

    advance(61);
    await legCompleted(p, "CA1", "avocat-42", "CAleg42", 0); // the leg that did not answer: ignored
    await legCompleted(p, "CA1", "avocat-7", "CAleg7", 61);
    await parentEnded("CA1", 70);
    await parentEnded("CA1", 70); // repeated status callback: no second debit

    const completed = events("call.completed");
    expect(completed).toHaveLength(1);
    // 61 s = 2 started minutes × 2 credits.
    expect(completed[0]!.payload).toMatchObject({ member_external_id: "avocat-7", duration_s: 61, credits: 4, billing: "billed", unbilled_credits: 0 });
    const credits = (await call("GET", "/v1/partner/credits", bearer(p.key))).json();
    expect(credits).toMatchObject({ balance: 96, creditPerMinute: 2 });
    expect(credits.ledger.map((l: { delta: number; reason: string }) => [l.reason, l.delta])).toEqual([["call", -4], ["topup", 100]]);

    const calls = (await call("GET", "/v1/partner/calls", bearer(p.key))).json();
    expect(calls.calls).toEqual([
      expect.objectContaining({ externalId: "avocat-7", direction: "inbound", huntGroup: "trouver-un-avocat", from: "+14385550199", durationS: 61, credits: 4, billing: "billed", recordingUrl: null }),
    ]);
    expect((await call("GET", "/v1/partner/calls?member=avocat-42", bearer(p.key))).json().calls).toEqual([]);
    expect((await call("GET", `/v1/partner/calls?since=${encodeURIComponent(now.toISOString())}`, bearer(p.key))).json().calls).toEqual([]);
  });

  it("an app member answers through the leg status callback; nobody answering is free", async () => {
    const p = await makePartner();
    await ctx.repo.handles.create({ handle: "@metremblay", userId: p.staff.user.id, telecomAccountId: p.staff.account.id });
    const h = bearer(p.key);
    await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", handle: "@metremblay" });
    await call("PUT", "/v1/partner/hunt-groups/g", h, { members: ["avocat-42"], strategy: "simultaneous", did: p.didNumber.e164 });
    await topUp(p, 10);

    const twiml = (await ring(p, "CA2")).body;
    expect(twiml).toMatch(new RegExp(`<Client statusCallback="[^"]+/pbx/leg\\?[^"]+" statusCallbackMethod="POST" statusCallbackEvent="answered completed">${p.staff.user.id}</Client>`));
    const m = (await ctx.repo.partners.getMember(p.partnerId, "avocat-42"))!;
    await twilioPost(ctx, `/webhooks/twilio/pbx/leg?b=${p.business.id}&x=${m.extensionId}`, { CallSid: "CAapp", ParentCallSid: "CA2", CallStatus: "in-progress" });
    expect((await ctx.repo.partners.getCallBySid("CA2"))!.externalId).toBe("avocat-42");
    advance(30);
    // The parent ends before the leg reports: talk time = answer → end.
    await parentEnded("CA2", 40);
    expect((await ctx.repo.partners.getCallBySid("CA2"))!).toMatchObject({ talkS: 30, creditsCharged: 2, billing: "billed" });

    await ring(p, "CA3");
    await parentEnded("CA3", 20);
    expect((await ctx.repo.partners.getCallBySid("CA3"))!).toMatchObject({ talkS: 0, creditsCharged: 0, billing: "free", externalId: null });
  });

  it("never goes below zero: partial then unbilled, the caller still rings, one alert until a top-up", async () => {
    const p = await makePartner();
    await setWebhook(p);
    await lawyersAndHunt(p);
    await topUp(p, 3);

    const talk = async (sid: string, seconds: number) => {
      const twiml = (await ring(p, sid)).body;
      expect(twiml).toContain("<Dial"); // still rings with no credits: we never drop a caller
      await answerOnMobile(p, sid, "avocat-42", `${sid}-leg`);
      advance(seconds);
      await legCompleted(p, sid, "avocat-42", `${sid}-leg`, seconds);
      await parentEnded(sid, seconds + 5);
      return (await ctx.repo.partners.getCallBySid(sid))!;
    };
    // 2 minutes × 2 credits = 4, only 3 left: 3 taken, balance 0.
    expect(await talk("CAa", 100)).toMatchObject({ creditsCharged: 3, billing: "partial" });
    expect(await talk("CAb", 30)).toMatchObject({ creditsCharged: 0, billing: "unbilled" });
    expect(await talk("CAc", 30)).toMatchObject({ creditsCharged: 0, billing: "unbilled" });
    expect((await ctx.repo.partners.getPartner(p.partnerId))!.creditBalance).toBe(0);
    expect(ctx.repo.partners.ledger.every((l) => l.balanceAfter >= 0)).toBe(true);
    expect(ctx.repo.auditLog.filter((a) => a.action === "partner.credits_exhausted")).toHaveLength(1);
    expect(events("call.completed").map((e) => e.payload.unbilled_credits)).toEqual([1, 2, 2]);

    // A top-up re-arms the alert; the same idempotency key never credits twice.
    expect((await topUp(p, 50, "topup-key-0001")).json()).toMatchObject({ duplicate: false, balance: 50 });
    expect((await topUp(p, 50, "topup-key-0001")).json()).toMatchObject({ duplicate: true, balance: 50 });
    expect((await ctx.repo.partners.getPartner(p.partnerId))!.creditsExhaustedAt).toBeNull();
    // Audited once per real top-up (3, then 50), not for the replay.
    expect(ctx.repo.auditLog.filter((a) => a.action === "partner.credits_topup").map((a) => a.meta?.credits)).toEqual([3, 50]);
  });

  it("per-partner rate overrides PARTNER_CREDIT_PER_MINUTE", async () => {
    const p = await makePartner();
    await call("PATCH", `/v1/admin/partners/${p.partnerId}`, p.admin.auth, { creditPerMinute: 5 });
    expect((await call("GET", "/v1/partner/credits", bearer(p.key))).json().creditPerMinute).toBe(5);
  });

  it("recording.ready carries ids only; the call shows a signed URL through our API, never Twilio's", async () => {
    const p = await makePartner({ plan: "business_pro" });
    await setWebhook(p);
    await lawyersAndHunt(p);
    await ring(p, "CArec");
    await answerOnMobile(p, "CArec", "avocat-42", "CArec-leg");
    await twilioPost(ctx, `/webhooks/twilio/pbx/recording?b=${p.business.id}&s=all`, {
      CallSid: "CArec",
      RecordingSid: "RE1",
      RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1",
      RecordingStatus: "completed",
      RecordingDuration: "42",
    });
    const ev = events("recording.ready")[0]!;
    expect(ev.payload).toMatchObject({ member_external_id: "avocat-42", duration_s: 42 });
    expect(JSON.stringify(ev.payload)).not.toContain("twilio.com");
    const recId = ev.payload.recording_id as string;

    const c = (await call("GET", "/v1/partner/calls", bearer(p.key))).json().calls[0];
    expect(c.recordingUrl).toMatch(new RegExp(`^${BASE_URL}/v1/business/${p.business.id}/recordings/${recId}/audio\\?token=`));
    const audio = await ctx.app.inject({ method: "GET", url: c.recordingUrl.slice(BASE_URL.length) });
    expect(audio.statusCode).toBe(200);
    const fresh = await call("GET", `/v1/partner/recordings/${recId}`, bearer(p.key));
    expect(fresh.json().url).toContain(`/recordings/${recId}/audio?token=`);
  });

  it("calls to a business that is not a partner keep their TwiML and leave no partner record", async () => {
    const { didNumber, business, ext } = await makeBusiness(ctx);
    await ctx.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "extension", extensionId: ext.id } });
    const twiml = (await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAx", From: "+14385550199", To: didNumber.e164 })).body;
    expect(twiml).not.toContain("statusCallback");
    expect(ctx.repo.partners.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------- webhooks

describe("partners: webhooks", () => {
  type Sent = { url: string; headers: Record<string, string>; body: string };
  const fakeFetch = (statuses: number[]) => {
    const sent: Sent[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(null, { status: statuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
    return { sent, impl };
  };

  it("signs with X-MIMT-Signature t=<ts>,v1=<HMAC-SHA256 of '<ts>.<body>'> and retries with backoff", async () => {
    const p = await makePartner();
    const secret = await setWebhook(p);
    expect(secret).toMatch(/^whsec_/);
    expect(ctx.repo.partners.partners[0]!.webhookSecretEncrypted).not.toContain(secret);
    await lawyersAndHunt(p);
    await ring(p, "CAw");

    const failing = fakeFetch([500]);
    expect(await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl: failing.impl })).toEqual({ delivered: 0, failed: 1 });
    const ev = ctx.repo.partners.events[0]!;
    expect(ev).toMatchObject({ attempts: 1, deliveredAt: null, lastError: "HTTP 500" });
    expect(ev.nextAttemptAt!.getTime() - now.getTime()).toBe(30_000);
    // Not due yet: nothing sent.
    expect((await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl: failing.impl })).failed).toBe(0);

    advance(30);
    const ok = fakeFetch([204]);
    expect(await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl: ok.impl })).toEqual({ delivered: 1, failed: 0 });
    const sent = ok.sent[0]!;
    expect(sent.url).toBe("https://hooks.besoinavocat.test/mimt");
    expect(sent.headers["x-mimt-event"]).toBe("call.ringing");
    // Partner-side verification (the Node snippet of docs/MIMT-CONNECT.md).
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent.headers["x-mimt-signature"]!)!;
    expect(v1).toBe(createHmac("sha256", secret).update(`${t}.${sent.body}`).digest("hex"));
    const body = JSON.parse(sent.body);
    expect(body).toMatchObject({ id: ev.id, type: "call.ringing", data: { partner_id: p.partnerId, hunt_group: "trouver-un-avocat" } });
    expect(sent.body).not.toMatch(/audio|transcript|twilio/i);
    expect(ctx.repo.partners.events[0]!.deliveredAt).not.toBeNull();
  });

  it("gives up after the last attempt; a redirect is a failure; a removed webhook drops its events", async () => {
    const p = await makePartner();
    await setWebhook(p);
    await lawyersAndHunt(p);
    await ring(p, "CAd");
    for (let i = 0; i < WEBHOOK_MAX_ATTEMPTS; i++) {
      await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl: fakeFetch([302]).impl });
      advance(5 * 3600);
    }
    expect(ctx.repo.partners.events[0]).toMatchObject({ attempts: WEBHOOK_MAX_ATTEMPTS, nextAttemptAt: null, deliveredAt: null, lastError: "HTTP 302" });

    await ring(p, "CAe");
    await call("PUT", `/v1/admin/partners/${p.partnerId}/webhook`, p.admin.auth, { url: null });
    const f = fakeFetch([200]);
    await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl: f.impl });
    expect(f.sent).toHaveLength(0);
    expect(ctx.repo.partners.events[1]).toMatchObject({ nextAttemptAt: null, deliveredAt: null });
  });

  it("only public https URLs; the secret is shown when first set or rotated, never again", async () => {
    const p = await makePartner();
    for (const url of ["http://hooks.example.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://user:pw@hooks.example.com/x", "https://intranet/x"]) {
      const res = await call("PUT", `/v1/business/${p.business.id}/partner/webhook`, p.owner.auth, { url });
      expect(res.statusCode, url).toBe(400);
    }
    const first = (await call("PUT", `/v1/business/${p.business.id}/partner/webhook`, p.owner.auth, { url: "https://hooks.example.com/a" })).json();
    expect(first.secret).toMatch(/^whsec_/);
    const moved = (await call("PUT", `/v1/business/${p.business.id}/partner/webhook`, p.owner.auth, { url: "https://hooks.example.com/b" })).json();
    expect(moved).toEqual({ webhookUrl: "https://hooks.example.com/b", secret: null });
    const rotated = (await call("PUT", `/v1/business/${p.business.id}/partner/webhook`, p.owner.auth, { url: "https://hooks.example.com/b", rotateSecret: true })).json();
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(first.secret);
  });

  it("no webhook configured: nothing is queued", async () => {
    const p = await makePartner();
    await lawyersAndHunt(p);
    await ring(p, "CAn");
    expect(ctx.repo.partners.events).toHaveLength(0);
    expect(ctx.repo.partners.calls).toHaveLength(1);
  });
});
