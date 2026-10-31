// « MIMT Connect » lot A (issue #97; docs/MIMT-CONNECT.md): account-link consent (codes, step-up, uniqueness, brute
// force), revocation from either side, the member's line (ownership), click-to-call (guards, credits, both TwiML legs,
// billing) and the new signed webhooks. Twilio is mocked; webhooks are signed with the test auth token.
import { createHmac } from "node:crypto";
import { PARTNER_LINK_CODE_ALPHABET } from "@mimt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPartnerWebhooks, webhookUrlProblem } from "../src/services/partners.js";
import { slugify } from "../src/routes/partners.js";
import { monthPeriod } from "../src/lib/time.js";
import { fakeTwilio, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";

let ctx: Ctx;
let now: Date;
let sids = 0;
const createCall = vi.fn(async (_input: { to: string; from: string; url: string; statusCallback?: string }) => ({ sid: `CAc2c${++sids}` }));

beforeEach(async () => {
  now = new Date("2026-10-30T15:00:00Z");
  createCall.mockClear();
  sids = 0;
  ctx = await setup({ config: { PARTNERS: "on", PARTNER_CREDIT_PER_MINUTE: "2" }, now: () => now, twilio: { ...fakeTwilio(), createCall } });
});
afterEach(() => ctx.app.close());

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const advance = (s: number) => (now = new Date(now.getTime() + s * 1000));
const silentLog = { warn: () => undefined, error: () => undefined };

/** Partner « BesoinAvocat » (slug besoinavocat) with a key, a webhook, credits and two members. */
async function makePartner(opts: { credits?: number } = {}) {
  const biz = await makeBusiness(ctx);
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  const created = await call("POST", "/v1/admin/partners", admin.auth, { businessId: biz.business.id, name: "BesoinAvocat", slug: "besoinavocat" });
  expect(created.statusCode).toBe(201);
  const partnerId = created.json().id as string;
  const k = await call("POST", `/v1/admin/partners/${partnerId}/keys`, admin.auth, { label: "portail" });
  const hook = await call("PUT", `/v1/admin/partners/${partnerId}/webhook`, admin.auth, { url: "https://portail.besoinavocat.ca/api/mimt/webhook" });
  expect(hook.statusCode).toBe(200);
  if (opts.credits ?? 1000) {
    const t = await call("POST", `/v1/admin/partners/${partnerId}/credits`, admin.auth, { credits: opts.credits ?? 1000, idempotencyKey: `topup-${partnerId.slice(0, 8)}` });
    expect(t.statusCode).toBe(200);
  }
  const h = bearer(k.json().key as string);
  expect((await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", phone: "+15145550142" })).statusCode).toBe(201);
  expect((await call("PUT", "/v1/partner/members/avocat-7", h, { name: "Me Roy" })).statusCode).toBe(201);
  return { ...biz, admin, partnerId, h, secret: hook.json().secret as string };
}
type P = Awaited<ReturnType<typeof makePartner>>;

const requestLink = async (p: P, externalId = "avocat-42") => {
  const res = await call("POST", `/v1/partner/members/${externalId}/link-requests`, p.h);
  expect(res.statusCode).toBe(201);
  return res.json() as { requestId: string; code: string; url: string; expiresAt: string };
};
const approve = (auth: Record<string, string>, body: { code: string; requestId?: string }) => call("POST", "/v1/me/partner-links/approve", auth, body);

/** A lawyer: their own MIMT account and number, linked to avocat-42. */
async function linkedLawyer(p: P, externalId = "avocat-42", number = "+15145550177") {
  const lawyer = await makeUser(ctx, { number });
  const r = await requestLink(p, externalId);
  const res = await approve(lawyer.auth, { code: r.code, requestId: r.requestId });
  expect(res.statusCode).toBe(201);
  return { ...lawyer, linkId: res.json().id as string };
}

const member = async (p: P, externalId: string) => ctx.repo.partners.getMember(p.partnerId, externalId);
const events = (type?: string) => ctx.repo.partners.events.filter((e) => !type || e.eventType === type);

// ---------------------------------------------------------------------------------------------- kill switch

describe("lot A: kill switch", () => {
  it("PARTNERS=off answers 404 on every new route and the click-to-call steps hang up", async () => {
    const p = await makePartner();
    const lawyer = await makeUser(ctx);
    ctx.deps.config.PARTNERS = "off";
    const id = "00000000-0000-4000-8000-000000000000";
    const routes: Array<[Method, string, Record<string, string>]> = [
      ["POST", "/v1/partner/members/avocat-42/link-requests", p.h],
      ["DELETE", "/v1/partner/members/avocat-42/link", p.h],
      ["GET", "/v1/partner/members/avocat-42/numbers", p.h],
      ["PUT", "/v1/partner/members/avocat-42/number", p.h],
      ["POST", "/v1/partner/members/avocat-42/calls", p.h],
      ["POST", "/v1/me/partner-links/preview", lawyer.auth],
      ["POST", "/v1/me/partner-links/approve", lawyer.auth],
      ["GET", "/v1/me/partner-links", lawyer.auth],
      ["DELETE", `/v1/me/partner-links/${id}`, lawyer.auth],
    ];
    for (const [method, url, headers] of routes) {
      const res = await ctx.app.inject({ method, url, headers, ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error).toBe("not_found");
    }
    const answer = await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-answer?b=${p.business.id}&to=%2B15145550199&cid=%2B15145550177&tl=600&w=0`, { CallSid: "CAx" });
    expect(answer.body).toContain("<Hangup/>");
    expect(answer.body).not.toContain("<Dial");
  });
});

// ------------------------------------------------------------------------------------------- link codes

describe("lot A: account-link consent", () => {
  it("issues a short hashed one-time code and a /lier URL, and links only with the signed-in user's approval", async () => {
    const p = await makePartner();
    const r = await requestLink(p);
    expect(r.code).toMatch(new RegExp(`^[${PARTNER_LINK_CODE_ALPHABET}]{8}$`));
    expect(r.code).not.toMatch(/[01OIL]/);
    expect(r.url).toBe(`https://app.mimt.ca/lier?code=${r.code}&r=${r.requestId}`);
    expect(new Date(r.expiresAt).getTime() - now.getTime()).toBe(15 * 60_000);
    // Stored hashed only, never in clear (rows, audit).
    expect(JSON.stringify(ctx.repo.partners.linkRequests)).not.toContain(r.code);
    expect(JSON.stringify(ctx.repo.auditLog)).not.toContain(r.code);

    const lawyer = await makeUser(ctx, { number: "+15145550177" });
    const preview = await call("POST", "/v1/me/partner-links/preview", lawyer.auth, { code: r.code.toLowerCase().replace(/(.{4})/, "$1-") });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ partnerName: "BesoinAvocat", externalId: "avocat-42", memberName: "Me Tremblay", permissions: ["calls", "click_to_call", "number", "plan_status", "number_transfers", "availability"] });

    const ok = await approve(lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ partnerName: "BesoinAvocat", externalId: "avocat-42", lineNumber: null });

    // Member DTO: linked, no line yet, so the portal gets the « choose a number » link.
    const m = await call("GET", "/v1/partner/members/avocat-42", p.h);
    expect(m.json()).toMatchObject({ linked: true, lineNumber: null, chooseNumberUrl: "https://app.mimt.ca/numero?partner=besoinavocat" });
    // member.linked webhook, ids only (no MIMT user id).
    const ev = events("member.linked");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ member_external_id: "avocat-42" });
    expect(JSON.stringify(ev[0]!.payload)).not.toContain(lawyer.user.id);
    // Audit with internal ids only.
    const audit = ctx.repo.auditLog.find((a) => a.action === "partner.member_linked")!;
    expect(audit.actorUserId).toBe(lawyer.user.id);
    expect(JSON.stringify(audit.meta)).not.toContain("avocat-42");
    // Single use.
    const again = await approve(lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(again.statusCode).toBe(410);
    expect(again.json().error).toBe("link_code_expired");
  });

  it("rings the linked user's MIMT apps for the member (client identity = user id); the cellphone stays", async () => {
    const p = await makePartner();
    const hunt = await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", p.h, { members: ["avocat-42"], strategy: "simultaneous", did: p.didNumber.e164 });
    expect(hunt.statusCode).toBe(201);
    const before = (await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAin1", From: "+14385550199", To: p.didNumber.e164 })).body;
    expect(before).not.toContain("<Client");
    const lawyer = await linkedLawyer(p);
    const after = (await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAin2", From: "+14385550199", To: p.didNumber.e164 })).body;
    expect(after).toContain(`>${lawyer.user.id}</Client>`);
    expect(after).toContain("+15145550142");
    // A later PUT of the member by the partner keeps the link's ring target.
    await call("PUT", "/v1/partner/members/avocat-42", p.h, { name: "Me Julie Tremblay", phone: "+15145550142" });
    const ext = await ctx.repo.pbx.getExtension((await member(p, "avocat-42"))!.extensionId!);
    expect(ext!.userId).toBe(lawyer.user.id);
  });

  it("codes expire after 15 minutes", async () => {
    const p = await makePartner();
    const r = await requestLink(p);
    const lawyer = await makeUser(ctx);
    advance(15 * 60 + 1);
    const { accessToken } = await ctx.deps.sessions.issue(lawyer.user.id, undefined, { method: "sms" });
    const res = await approve({ authorization: `Bearer ${accessToken}` }, { code: r.code });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("link_code_expired");
  });

  it("a code dies after 5 wrong attempts on its request; a wrong code alone is 400", async () => {
    const p = await makePartner();
    const r = await requestLink(p);
    const lawyer = await makeUser(ctx);
    const wrong = r.code.startsWith("A") ? "BBBBBBBB" : "AAAAAAAA";
    expect((await approve(lawyer.auth, { code: wrong })).json().error).toBe("invalid_link_code");
    for (let i = 1; i <= 4; i++) {
      const res = await approve(lawyer.auth, { code: wrong, requestId: r.requestId });
      expect(res.statusCode, `attempt ${i}`).toBe(400);
    }
    const fifth = await approve(lawyer.auth, { code: wrong, requestId: r.requestId });
    expect(fifth.statusCode).toBe(410);
    // Even the right code is refused now (with or without the request id).
    expect((await approve(lawyer.auth, { code: r.code, requestId: r.requestId })).statusCode).toBe(410);
    expect((await approve(lawyer.auth, { code: r.code })).statusCode).toBe(410);
    expect(await ctx.repo.partners.getActiveLinkByMember((await member(p, "avocat-42"))!.id)).toBeNull();
  });

  it("a new request invalidates the previous code", async () => {
    const p = await makePartner();
    const first = await requestLink(p);
    const second = await requestLink(p);
    const lawyer = await makeUser(ctx);
    expect((await approve(lawyer.auth, { code: first.code })).statusCode).toBe(410);
    expect((await approve(lawyer.auth, { code: second.code })).statusCode).toBe(201);
  });

  it("approval requires a recent authentication (step-up); the code stays usable until then", async () => {
    const p = await makePartner();
    const lawyer = await makeUser(ctx);
    advance(11 * 60);
    const r = await requestLink(p);
    const refused = await approve(lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("step_up_required");
    // Confirmed again (fresh SMS code): same code works.
    const { accessToken } = await ctx.deps.sessions.issue(lawyer.user.id, undefined, { method: "sms" });
    expect((await approve({ authorization: `Bearer ${accessToken}` }, { code: r.code, requestId: r.requestId })).statusCode).toBe(201);
  });

  it("rate-limits code attempts per user (and per IP)", async () => {
    const p = await makePartner();
    const r = await requestLink(p);
    const lawyer = await makeUser(ctx);
    for (let i = 0; i < 10; i++) await call("POST", "/v1/me/partner-links/preview", lawyer.auth, { code: "ZZZZZZZZ" });
    const limited = await approve(lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(limited.statusCode).toBe(429);
    // Another person on another address is not affected.
    const other = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/me/partner-links/approve", headers: other.auth, remoteAddress: "203.0.113.9", payload: { code: r.code, requestId: r.requestId } });
    expect(res.statusCode).toBe(201);
  });

  it("uniqueness: one member per user per partner, one user per member", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p, "avocat-42");
    // The same user cannot take a second profile of this partner.
    const r7 = await requestLink(p, "avocat-7");
    const second = await approve(lawyer.auth, { code: r7.code, requestId: r7.requestId });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("already_linked_to_partner");
    // A linked member gets no new code until it is unlinked.
    const again = await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("member_already_linked");
    // Someone else can take avocat-7.
    const other = await makeUser(ctx);
    expect((await approve(other.auth, { code: r7.code, requestId: r7.requestId })).statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------- revocation

describe("lot A: revoke from either side", () => {
  it("the user sees and revokes the link (Compte › Intégrations); the apps stop ringing; member.unlinked", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    const list = await call("GET", "/v1/me/partner-links", lawyer.auth);
    expect(list.json().links).toEqual([expect.objectContaining({ id: lawyer.linkId, partnerName: "BesoinAvocat", externalId: "avocat-42" })]);
    // Somebody else cannot revoke it.
    const stranger = await makeUser(ctx);
    expect((await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}`, stranger.auth)).statusCode).toBe(404);

    expect((await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}`, lawyer.auth)).statusCode).toBe(204);
    expect((await call("GET", "/v1/me/partner-links", lawyer.auth)).json().links).toEqual([]);
    const ext = await ctx.repo.pbx.getExtension((await member(p, "avocat-42"))!.extensionId!);
    expect(ext!.userId).toBeNull();
    expect(ext!.forwardToMobile).toBe("+15145550142");
    expect(events("member.unlinked")[0]!.payload).toMatchObject({ member_external_id: "avocat-42", by: "user" });
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json().linked).toBe(false);
  });

  it("the partner unlinks with DELETE …/link", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    expect((await call("DELETE", "/v1/partner/members/avocat-42/link", p.h)).statusCode).toBe(204);
    expect((await call("DELETE", "/v1/partner/members/avocat-42/link", p.h)).statusCode).toBe(404);
    expect(events("member.unlinked")[0]!.payload).toMatchObject({ member_external_id: "avocat-42", by: "partner" });
    expect((await call("GET", "/v1/me/partner-links", lawyer.auth)).json().links).toEqual([]);
    const audit = ctx.repo.auditLog.filter((a) => a.action === "partner.member_unlinked");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBeNull();
    // A new link can be made afterwards.
    const r = await requestLink(p);
    expect((await approve(lawyer.auth, { code: r.code })).statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------- the line

describe("lot A: the member's line", () => {
  it("needs an active link; offers chooseNumberUrl when there is no link or no number", async () => {
    const p = await makePartner();
    const res = await call("GET", "/v1/partner/members/avocat-42/numbers", p.h);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "member_not_linked", chooseNumberUrl: "https://app.mimt.ca/numero?partner=besoinavocat" });

    const lawyer = await makeUser(ctx); // No number yet.
    const r = await requestLink(p);
    expect((await approve(lawyer.auth, { code: r.code })).statusCode).toBe(201);
    const none = await call("GET", "/v1/partner/members/avocat-42/numbers", p.h);
    expect(none.json()).toEqual({ numbers: [], current: null, chooseNumberUrl: "https://app.mimt.ca/numero?partner=besoinavocat" });
  });

  it("attaches only one of the linked user's own active numbers; member.number_changed", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p, "avocat-42", "+15145550177");
    const list = await call("GET", "/v1/partner/members/avocat-42/numbers", p.h);
    expect(list.json()).toMatchObject({ numbers: [{ e164: "+15145550177" }], current: null });

    // Someone else's number (the business DID), or a number nobody holds: refused.
    for (const e164 of [p.didNumber.e164, "+15145550999"]) {
      const res = await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164 });
      expect(res.statusCode, e164).toBe(403);
      expect(res.json().error).toBe("number_not_owned");
    }
    expect(events("member.number_changed")).toHaveLength(0);

    const ok = await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ current: "+15145550177", chooseNumberUrl: null });
    expect(events("member.number_changed")[0]!.payload).toMatchObject({ member_external_id: "avocat-42", number: "+15145550177" });
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json()).toMatchObject({ lineNumber: "+15145550177", chooseNumberUrl: null });
    expect((await call("GET", "/v1/me/partner-links", lawyer.auth)).json().links[0].lineNumber).toBe("+15145550177");
    // Same number again: nothing new.
    await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" });
    expect(events("member.number_changed")).toHaveLength(1);
    // A number that leaves the user's hands stops being the line at once.
    await ctx.repo.updateNumber(lawyer.number!.id, { state: "grace" });
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json().lineNumber).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ click-to-call

async function readyLawyer(p: P) {
  const lawyer = await linkedLawyer(p, "avocat-42", "+15145550177");
  expect((await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" })).statusCode).toBe(200);
  return lawyer;
}
const c2c = (p: P, body: Record<string, unknown>, externalId = "avocat-42") => call("POST", `/v1/partner/members/${externalId}/calls`, p.h, body);
const pathOf = (url: string) => url.replace("https://api.test.mimt.ca", "");

describe("lot A: click-to-call guards", () => {
  it("refuses without a link or without a line (with chooseNumberUrl)", async () => {
    const p = await makePartner();
    const noLink = await c2c(p, { to: "+15145550199" });
    expect(noLink.statusCode).toBe(409);
    expect(noLink.json()).toMatchObject({ error: "member_not_linked", chooseNumberUrl: "https://app.mimt.ca/numero?partner=besoinavocat" });
    await linkedLawyer(p);
    const noNumber = await c2c(p, { to: "+15145550199" });
    expect(noNumber.statusCode).toBe(409);
    expect(noNumber.json()).toMatchObject({ error: "member_number_required", chooseNumberUrl: "https://app.mimt.ca/numero?partner=besoinavocat" });
    expect(createCall).not.toHaveBeenCalled();
  });

  it("never dials 9-1-1, N11, premium 900/976, high-cost NANP or international", async () => {
    const p = await makePartner();
    await readyLawyer(p);
    for (const to of ["911", "9-1-1", "+1911", "411", "811", "+19005550100", "+15149765555", "+18765551234", "+33142685300", "pas un numéro"]) {
      const res = await c2c(p, { to });
      expect(res.statusCode, to).toBe(400);
      expect(["destination_not_allowed", "invalid_number"], to).toContain(res.json().error);
    }
    expect(createCall).not.toHaveBeenCalled();
  });

  it("refuses with 402 insufficient_credits when the partner cannot pay a minute", async () => {
    const p = await makePartner({ credits: 0 });
    await readyLawyer(p);
    const res = await c2c(p, { to: "+15145550199" });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("insufficient_credits");
    expect(createCall).not.toHaveBeenCalled();
  });

  it("one call at a time per member, and a per-member attempt limit", async () => {
    const p = await makePartner();
    await readyLawyer(p);
    const first = await c2c(p, { to: "+15145550199" });
    expect(first.statusCode).toBe(201);
    const busy = await c2c(p, { to: "+15145550199" });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toBe("call_in_progress");
    // Finish each call; the 7th attempt in a minute is refused (CALL_ATTEMPT_RULES.minute = 6).
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-status?b=${p.business.id}`, { CallSid: "CAc2c1", CallStatus: "no-answer" });
    for (let i = 0; i < 4; i++) {
      const res = await c2c(p, { to: "+15145550199" });
      expect(res.statusCode).toBe(201);
      await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-status?b=${p.business.id}`, { CallSid: `CAc2c${sids}`, CallStatus: "no-answer" });
    }
    const limited = await c2c(p, { to: "+15145550199" });
    expect(limited.statusCode).toBe(429);
    expect(ctx.repo.fraudEvents.some((f) => f.rule === "partner_c2c_rate")).toBe(true);
  });
});

describe("lot A: click-to-call flow", () => {
  it("rings the member's apps, then dials `to` with the line as caller ID; debits partner credits; signed events", async () => {
    const p = await makePartner();
    const lawyer = await readyLawyer(p);
    const res = await c2c(p, { to: "514 555-0199", reference: "dossier-881" });
    expect(res.statusCode).toBe(201);
    const { callId } = res.json() as { callId: string };

    expect(createCall).toHaveBeenCalledTimes(1);
    const placed = createCall.mock.calls[0]![0];
    expect(placed.to).toBe(`client:${lawyer.user.id}`);
    expect(placed.from).toBe("+15145550177");
    expect(placed.url).toContain("/webhooks/twilio/pbx/c2c-answer?");
    expect(placed.statusCallback).toContain("/webhooks/twilio/pbx/c2c-status?");
    const ringing = events("call.ringing")[0]!;
    expect(ringing.payload).toMatchObject({ call_id: callId, direction: "outbound", member_external_id: "avocat-42", reference: "dossier-881", from: "+15145550177", to: "+15145550199" });

    // Unsigned webhooks are refused (X-Twilio-Signature check).
    expect((await twilioPost(ctx, pathOf(placed.url), { CallSid: "CAc2c1" }, "bad-signature")).statusCode).toBe(403);

    // Leg 1 answered in the apps: straight to the destination, caller ID = the lawyer's line, time limit from credits.
    const twiml = (await twilioPost(ctx, pathOf(placed.url), { CallSid: "CAc2c1", CallStatus: "in-progress" })).body;
    expect(twiml).toContain('callerId="+15145550177"');
    expect(twiml).toContain('timeLimit="14400"');
    expect(twiml).toMatch(/<Number statusCallback="https:\/\/api\.test\.mimt\.ca\/webhooks\/twilio\/pbx\/c2c-leg\?b=[^"]+"[^>]*>\+15145550199<\/Number>/);
    expect(twiml).not.toContain("<Gather");

    // Leg 2: the client answers, talks 125 s; then the call ends.
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-leg?b=${p.business.id}`, { CallSid: "CAleg1", ParentCallSid: "CAc2c1", CallStatus: "in-progress" });
    expect(events("call.answered")[0]!.payload).toMatchObject({ call_id: callId, direction: "outbound", member_external_id: "avocat-42" });
    advance(130);
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-leg?b=${p.business.id}`, { CallSid: "CAleg1", ParentCallSid: "CAc2c1", CallStatus: "completed", CallDuration: "125" });
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-status?b=${p.business.id}`, { CallSid: "CAc2c1", CallStatus: "completed", CallDuration: "140" });
    // Twilio retries the status: debited once.
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-status?b=${p.business.id}`, { CallSid: "CAc2c1", CallStatus: "completed", CallDuration: "140" });

    const done = events("call.completed");
    expect(done).toHaveLength(1);
    expect(done[0]!.payload).toMatchObject({ call_id: callId, direction: "outbound", member_external_id: "avocat-42", reference: "dossier-881", duration_s: 125, credits: 6, billing: "billed" });
    expect((await call("GET", "/v1/partner/credits", p.h)).json().balance).toBe(1000 - 6);
    // The lawyer's own plan minutes are not used (partner credits pay, like hunt-group calls).
    expect((await ctx.repo.getUsage(lawyer.account.id, monthPeriod(now))).minutesOut).toBe(0);
    const calls = (await call("GET", "/v1/partner/calls?member=avocat-42", p.h)).json().calls;
    expect(calls[0]).toMatchObject({ id: callId, direction: "outbound", reference: "dossier-881", from: "+15145550177", to: "+15145550199", externalId: "avocat-42", credits: 6 });

    // Signed delivery of the events to https://portail.besoinavocat.ca/api/mimt/webhook.
    const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await deliverPartnerWebhooks(ctx.deps, silentLog, { fetchImpl, now });
    const types = sent.map((s) => JSON.parse(s.body).type);
    expect(types).toEqual(expect.arrayContaining(["member.linked", "member.number_changed", "call.ringing", "call.answered", "call.completed"]));
    for (const s of sent) {
      expect(s.url).toBe("https://portail.besoinavocat.ca/api/mimt/webhook");
      const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(s.headers["x-mimt-signature"]!)!;
      expect(v1).toBe(createHmac("sha256", p.secret).update(`${t}.${s.body}`).digest("hex"));
    }
  });

  it("on a cellphone: the « appuyez sur 1 » whisper first; only 1 places the call", async () => {
    const p = await makePartner();
    await readyLawyer(p);
    const res = await c2c(p, { to: "+15145550199", via: "mobile" });
    expect(res.statusCode).toBe(201);
    const placed = createCall.mock.calls[0]![0];
    expect(placed.to).toBe("+15145550142");
    expect(placed.from).toBe("+15145550177");
    const whisper = (await twilioPost(ctx, pathOf(placed.url), { CallSid: "CAc2c1" })).body;
    expect(whisper).toContain("<Gather");
    expect(whisper).toContain("/webhooks/twilio/pbx/c2c-connect?");
    expect(whisper).toContain("Appuyez sur 1");
    expect(whisper).not.toContain("<Dial");
    const connectUrl = pathOf(/action="([^"]+)"/.exec(whisper)![1]!.replace(/&amp;/g, "&"));
    const no = (await twilioPost(ctx, connectUrl, { CallSid: "CAc2c1", Digits: "2" })).body;
    expect(no).toContain("<Hangup/>");
    expect(no).not.toContain("<Dial");
    const yes = (await twilioPost(ctx, connectUrl, { CallSid: "CAc2c1", Digits: "1" })).body;
    expect(yes).toContain('callerId="+15145550177"');
    expect(yes).toContain(">+15145550199</Number>");
  });

  it("time limit follows the credits; an unanswered call is free", async () => {
    const p = await makePartner({ credits: 7 });
    await readyLawyer(p);
    await c2c(p, { to: "+15145550199" });
    const twiml = (await twilioPost(ctx, pathOf(createCall.mock.calls[0]![0].url), { CallSid: "CAc2c1" })).body;
    expect(twiml).toContain('timeLimit="180"'); // 7 credits at 2 per minute: 3 minutes.
    await twilioPost(ctx, `/webhooks/twilio/pbx/c2c-status?b=${p.business.id}`, { CallSid: "CAc2c1", CallStatus: "no-answer" });
    expect(events("call.completed")[0]!.payload).toMatchObject({ billing: "free", credits: 0 });
    expect((await call("GET", "/v1/partner/credits", p.h)).json().balance).toBe(7);
  });
});

// ------------------------------------------------------------------------------------------- webhook address

describe("lot A: webhook address and partner slug", () => {
  it("accepts any public https subdomain (portail.besoinavocat.ca)", () => {
    expect(webhookUrlProblem("https://portail.besoinavocat.ca/api/mimt/webhook")).toBeNull();
    expect(webhookUrlProblem("https://a.b.portail.besoinavocat.ca/hook?x=1")).toBeNull();
    expect(webhookUrlProblem("http://portail.besoinavocat.ca/api/mimt/webhook")).toBe("https_required");
  });

  it("derives a slug from the partner name and refuses a taken one", async () => {
    expect(slugify("besoinavocat.ca")).toBe("besoinavocat");
    expect(slugify("Café Test")).toBe("cafe-test");
    const p = await makePartner();
    const biz2 = await makeBusiness(ctx, { did: "+15145550101" });
    const dup = await call("POST", "/v1/admin/partners", p.admin.auth, { businessId: biz2.business.id, slug: "besoinavocat" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("slug_taken");
  });
});
