// « MIMT Connect » two-sided granular consent (owner's order 2026-10-31; docs/MIMT-CONNECT.md « Consentement »):
// partner terms (DPA) before any request, declared purposes, named scopes checked separately on /lier, required
// scopes, consent text version, step-up, scope enforcement (403 scope_not_granted) on every lot A and B route,
// webhooks suppressed without their scope (also at delivery), calls and recordings under a link, upgrades, receipts
// (coarse device and network, never a full IP), per-scope revoke, the access log and its 90-day retention, the
// migration of links approved before scopes existed, and the kill switch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTNER_CONSENT_TEXT_VERSION,
  PARTNER_LEGACY_CONSENT_VERSION,
  PARTNER_LEGACY_SCOPES,
  PARTNER_SCOPE_SET_VERSION,
  PARTNER_SCOPE_TEXT,
  PARTNER_SCOPES,
  PARTNER_TERMS_VERSION,
  type PartnerScope,
} from "@mimt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPartnerAccessLogRetention } from "../src/services/partnerConsent.js";
import { deliverPartnerWebhooks, emitPartnerEvent } from "../src/services/partners.js";
import { pushPayload } from "../src/services/webPush.js";
import { fakeTwilio, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";
import { acceptTerms, approveBody, purposeOf, scopeItems, termsBody } from "./partnerConsentFixtures.js";

let ctx: Ctx;
let now: Date;
let sids = 0;
const createCall = vi.fn(async (_input: { to: string; from: string; url: string; statusCallback?: string }) => ({ sid: `CAc2c${++sids}` }));

beforeEach(async () => {
  now = new Date("2026-10-31T15:00:00Z");
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
const events = (type?: string) => ctx.repo.partners.events.filter((e) => !type || e.eventType === type);
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Partner « BesoinAvocat » (Affaires Pro: recordings), key, webhook, credits, two members, a hunt group on the DID. */
async function makePartner(opts: { terms?: boolean; purposes?: Partial<Record<PartnerScope, string>> } = {}) {
  const biz = await makeBusiness(ctx, { plan: "business_pro" });
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  const created = await call("POST", "/v1/admin/partners", admin.auth, { businessId: biz.business.id, name: "BesoinAvocat", slug: "besoinavocat" });
  const partnerId = created.json().id as string;
  const k = await call("POST", `/v1/admin/partners/${partnerId}/keys`, admin.auth, { label: "portail" });
  await call("PUT", `/v1/admin/partners/${partnerId}/webhook`, admin.auth, { url: "https://portail.besoinavocat.ca/api/mimt/webhook" });
  await call("POST", `/v1/admin/partners/${partnerId}/credits`, admin.auth, { credits: 1000, idempotencyKey: `topup-${partnerId.slice(0, 8)}` });
  if (opts.terms !== false) await acceptTerms(ctx, admin.auth, partnerId, opts.purposes);
  const h = bearer(k.json().key as string);
  expect((await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", phone: "+15145550142" })).statusCode).toBe(201);
  expect((await call("PUT", "/v1/partner/members/avocat-7", h, { name: "Me Roy", phone: "+15145550107" })).statusCode).toBe(201);
  const hunt = await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", h, { members: ["avocat-42", "avocat-7"], strategy: "simultaneous", did: biz.didNumber.e164 });
  expect(hunt.statusCode).toBe(201);
  return { ...biz, admin, partnerId, h };
}
type P = Awaited<ReturnType<typeof makePartner>>;

const requestLink = async (p: P, items = scopeItems(), externalId = "avocat-42") => {
  const res = await call("POST", `/v1/partner/members/${externalId}/link-requests`, p.h, { scopes: items });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { requestId: string; code: string; kind: "link" | "upgrade" };
};

/** The person approves `scopes` (from `remote`, with a Chrome on Windows browser). */
const approve = (auth: Record<string, string>, r: { code: string; requestId: string }, scopes: readonly PartnerScope[], extra: { remote?: string; consentVersion?: string } = {}) =>
  ctx.app.inject({
    method: "POST",
    url: "/v1/me/partner-links/approve",
    headers: { ...auth, "user-agent": CHROME_WINDOWS },
    remoteAddress: extra.remote ?? "203.0.113.57",
    payload: { ...approveBody(r, scopes), ...(extra.consentVersion ? { consentVersion: extra.consentVersion } : {}) },
  });

/** A lawyer with their own MIMT account and number, linked to avocat-42 with exactly `scopes`. */
async function lawyerWith(p: P, scopes: readonly PartnerScope[], externalId = "avocat-42", number = "+15145550177") {
  const lawyer = await makeUser(ctx, { number });
  const r = await requestLink(p, scopeItems(), externalId);
  const res = await approve(lawyer.auth, r, scopes);
  expect(res.statusCode, res.body).toBe(201);
  return { ...lawyer, linkId: res.json().id as string };
}

/** Upgrade request + approval by the same person (fresh step-up). */
async function upgrade(p: P, lawyer: { auth: Record<string, string> }, items = scopeItems(), chosen: readonly PartnerScope[] = items.map((i) => i.scope)) {
  const r = await requestLink(p, items);
  expect(r.kind).toBe("upgrade");
  const res = await approve(lawyer.auth, r, chosen);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const myLinks = async (auth: Record<string, string>) => (await call("GET", "/v1/me/partner-links", auth)).json().links as Array<Record<string, unknown>>;

// ------------------------------------------------------------------------------------------- the partner side

describe("consent: the partner's side (terms, declared purposes)", () => {
  it("no link request before the partner's terms and DPA are accepted (409 partner_terms_required)", async () => {
    const p = await makePartner({ terms: false });
    const res = await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: scopeItems() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "partner_terms_required", termsVersion: PARTNER_TERMS_VERSION });
    // Even an empty body gets the terms answer first.
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, {})).json().error).toBe("partner_terms_required");
    await acceptTerms(ctx, p.admin.auth, p.partnerId);
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: scopeItems() })).statusCode).toBe(201);
  });

  it("terms acceptance: admin only, current version, step-up, audited, shown in the admin detail", async () => {
    const p = await makePartner({ terms: false });
    const url = `/v1/admin/partners/${p.partnerId}/terms-acceptance`;
    const stranger = await makeUser(ctx);
    expect((await call("POST", url, stranger.auth, termsBody())).statusCode).toBe(403);
    const old = await call("POST", url, p.admin.auth, { ...termsBody(), termsVersion: "2025-01-01" });
    expect(old.statusCode).toBe(400);
    expect(old.json().error).toBe("terms_version_mismatch");
    expect((await call("POST", url, p.admin.auth, termsBody({}))).json().error).toBe("purposes_required");
    expect((await call("POST", url, p.admin.auth, { ...termsBody(), purposes: { "calls.write": "x".repeat(20) } })).statusCode).toBe(400);
    expect((await call("POST", url, p.admin.auth, { ...termsBody(), acceptedAt: "2027-01-01T00:00:00Z" })).json().error).toBe("accepted_at_in_future");
    // Step-up: 11 minutes after the admin's sign-in, a recent confirmation is needed.
    advance(11 * 60);
    const stale = await call("POST", url, p.admin.auth, termsBody());
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe("step_up_required");
    const { accessToken } = await ctx.deps.sessions.issue(p.admin.user.id, undefined, { method: "sms" });
    const ok = await call("POST", url, { authorization: `Bearer ${accessToken}` }, termsBody({ "calls.read": purposeOf("calls.read") }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ termsVersion: PARTNER_TERMS_VERSION, current: true, legalName: "BesoinAvocat inc.", signerName: "Julie Gagnon", signerTitle: "Présidente" });
    const audit = ctx.repo.auditLog.find((a) => a.action === "partner.terms_accepted")!;
    expect(audit).toMatchObject({ actorUserId: p.admin.user.id, targetId: p.partnerId, meta: { scopes: ["calls.read"] } });
    const detail = await call("GET", `/v1/admin/partners/${p.partnerId}`, { authorization: `Bearer ${accessToken}` });
    expect(detail.json().terms).toMatchObject({ privacyContactEmail: "vieprivee@besoinavocat.ca", purposes: { "calls.read": purposeOf("calls.read") } });
  });

  it("a request may only ask for declared scopes, each once, each with a purpose", async () => {
    const p = await makePartner({ purposes: { "calls.read": purposeOf("calls.read"), "calls.place": purposeOf("calls.place") } });
    const undeclared = await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: scopeItems(["calls.read", "porting.read"]) });
    expect(undeclared.statusCode).toBe(403);
    expect(undeclared.json()).toMatchObject({ error: "scope_not_declared", scope: "porting.read" });
    const dup = await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: [...scopeItems(["calls.read"]), ...scopeItems(["calls.read"])] });
    expect(dup.json()).toMatchObject({ error: "duplicate_scope", scope: "calls.read" });
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: [] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: [{ scope: "calls.read", purpose: "short" }] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: [{ scope: "calls.read" }] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: [{ scope: "calls.write", purpose: "x".repeat(20) }] })).statusCode).toBe(400);
    const ok = await call("POST", "/v1/partner/members/avocat-42/link-requests", p.h, { scopes: scopeItems(["calls.place", "calls.read"], ["calls.read"]) });
    expect(ok.statusCode).toBe(201);
    // Display order, required made explicit.
    expect(ok.json()).toMatchObject({
      kind: "link",
      scopes: [
        { scope: "calls.read", purpose: purposeOf("calls.read"), required: true },
        { scope: "calls.place", purpose: purposeOf("calls.place"), required: false },
      ],
    });
  });

  it("GET /v1/partner/consent-text gives the portal the exact texts and versions shown on /lier", async () => {
    const p = await makePartner();
    const res = await call("GET", "/v1/partner/consent-text", p.h);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ consentVersion: PARTNER_CONSENT_TEXT_VERSION, scopeSetVersion: PARTNER_SCOPE_SET_VERSION, termsVersion: PARTNER_TERMS_VERSION });
    expect(res.json().scopes.map((s: { scope: string }) => s.scope)).toEqual([...PARTNER_SCOPES]);
    expect(res.json().scopes[0].fr).toEqual(PARTNER_SCOPE_TEXT["calls.read"].fr);
    expect((await call("GET", "/v1/partner/consent-text")).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------- the person's side

describe("consent: the person checks each scope (/lier)", () => {
  it("preview: who asks (legal name, privacy contact), why, which scopes are required, the text version", async () => {
    const p = await makePartner();
    const r = await requestLink(p, scopeItems(["calls.read", "line.manage", "subscription.read"], ["calls.read"]));
    const lawyer = await makeUser(ctx);
    const res = await call("POST", "/v1/me/partner-links/preview", lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      requestId: r.requestId,
      kind: "link",
      partnerName: "BesoinAvocat",
      partnerLegalName: "BesoinAvocat inc.",
      privacyContactEmail: "vieprivee@besoinavocat.ca",
      termsVersion: PARTNER_TERMS_VERSION,
      externalId: "avocat-42",
      memberName: "Me Tremblay",
      scopes: [
        { scope: "calls.read", purpose: purposeOf("calls.read"), required: true, granted: false },
        { scope: "line.manage", purpose: purposeOf("line.manage"), required: false, granted: false },
        { scope: "subscription.read", purpose: purposeOf("subscription.read"), required: false, granted: false },
      ],
      currentScopes: [],
      consentVersion: PARTNER_CONSENT_TEXT_VERSION,
      expiresAt: expect.any(String),
    });
  });

  it("required scopes must be checked; only requested scopes; at least one; a refusal does not burn the code", async () => {
    const p = await makePartner();
    const r = await requestLink(p, scopeItems(["calls.read", "calls.place", "line.manage"], ["calls.read", "line.manage"]));
    const lawyer = await makeUser(ctx, { number: "+15145550177" });
    const none = await approve(lawyer.auth, r, []);
    expect(none.json()).toMatchObject({ error: "required_scope_missing", scope: "calls.read" });
    const half = await approve(lawyer.auth, r, ["calls.read"]);
    expect(half.statusCode).toBe(400);
    expect(half.json()).toMatchObject({ error: "required_scope_missing", scope: "line.manage" });
    const extra = await approve(lawyer.auth, r, ["calls.read", "line.manage", "recordings.read"]);
    expect(extra.json()).toMatchObject({ error: "scope_not_requested", scope: "recordings.read" });
    const ok = await approve(lawyer.auth, r, ["line.manage", "calls.read"]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ scopes: ["calls.read", "line.manage"], requiredScopes: ["calls.read", "line.manage"], consentVersion: PARTNER_CONSENT_TEXT_VERSION, consentCurrent: true });
    expect(ok.json().purposes).toEqual({ "calls.read": purposeOf("calls.read"), "line.manage": purposeOf("line.manage") });
  });

  it("nothing checked when nothing is required is refused (no empty link)", async () => {
    const p = await makePartner();
    const r = await requestLink(p, scopeItems(["calls.read"]));
    const lawyer = await makeUser(ctx);
    expect((await approve(lawyer.auth, r, [])).json().error).toBe("no_scope_selected");
  });

  it("the consent text version shown must be the current one (409 consent_text_changed)", async () => {
    const p = await makePartner();
    const r = await requestLink(p);
    const lawyer = await makeUser(ctx);
    const res = await approve(lawyer.auth, r, ["calls.read"], { consentVersion: "2026-01-01" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "consent_text_changed", consentVersion: PARTNER_CONSENT_TEXT_VERSION });
    expect((await approve(lawyer.auth, r, ["calls.read"])).statusCode).toBe(201);
  });

  it("approval (and an upgrade approval) needs a recent step-up", async () => {
    const p = await makePartner();
    const lawyer = await makeUser(ctx);
    advance(11 * 60);
    const r = await requestLink(p, scopeItems(["calls.read"]));
    expect((await approve(lawyer.auth, r, ["calls.read"])).json().error).toBe("step_up_required");
    const fresh = { authorization: `Bearer ${(await ctx.deps.sessions.issue(lawyer.user.id, undefined, { method: "sms" })).accessToken}` };
    expect((await approve(fresh, r, ["calls.read"])).statusCode).toBe(201);
    advance(11 * 60);
    const up = await requestLink(p, scopeItems(["subscription.read"]));
    expect((await approve(fresh, up, ["subscription.read"])).json().error).toBe("step_up_required");
  });
});

// ------------------------------------------------------------------------------------------- enforcement

describe("consent: every lot A and B route checks its scope", () => {
  const routes: Array<[Method, string, PartnerScope, unknown?]> = [
    ["GET", "/v1/partner/members/avocat-42/numbers", "line.manage"],
    ["PUT", "/v1/partner/members/avocat-42/number", "line.manage", { e164: "+15145550177" }],
    ["POST", "/v1/partner/members/avocat-42/calls", "calls.place", { to: "+14385550199" }],
    ["GET", "/v1/partner/members/avocat-42/subscription", "subscription.read"],
    ["GET", "/v1/partner/members/avocat-42/port-ins", "porting.read"],
    ["GET", "/v1/partner/members/avocat-42/availability", "availability.manage"],
    ["PUT", "/v1/partner/members/avocat-42/availability", "availability.manage", { status: "busy" }],
  ];

  it("403 scope_not_granted naming the scope, logged as denied; allowed once granted", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read"]);
    for (const [method, url, scope, body] of routes) {
      const res = await call(method, url, p.h, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json(), `${method} ${url}`).toMatchObject({ error: "scope_not_granted", scope });
    }
    const log = (await call("GET", `/v1/me/partner-links/${lawyer.linkId}/access-log`, lawyer.auth)).json();
    expect(log.retentionDays).toBe(90);
    expect(log.entries).toHaveLength(routes.length);
    expect(log.entries.every((e: { outcome: string }) => e.outcome === "denied")).toBe(true);
    expect(log.entries.map((e: { route: string }) => e.route)).toContain("GET /v1/partner/members/:externalId/subscription");
    // Route templates only: never the member id, a number or a body.
    expect(JSON.stringify(log)).not.toMatch(/avocat-42|\+1514|busy/);

    await upgrade(p, lawyer);
    for (const [method, url, scope, body] of routes) {
      const res = await call(method, url, p.h, body);
      expect([200, 201], `${method} ${url} (${scope}) → ${res.body}`).toContain(res.statusCode);
    }
    const after = (await call("GET", `/v1/me/partner-links/${lawyer.linkId}/access-log`, lawyer.auth)).json().entries;
    expect(after.filter((e: { outcome: string }) => e.outcome === "allowed").map((e: { scope: string }) => e.scope)).toEqual(
      expect.arrayContaining(["line.manage", "calls.place", "subscription.read", "porting.read", "availability.manage"]),
    );
  });

  it("the member DTO shows the line only with line.manage; a member without a MIMT link needs no scope", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["line.manage"]);
    expect((await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" })).statusCode).toBe(200);
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json()).toMatchObject({ linked: true, lineNumber: "+15145550177", scopes: ["line.manage"], consentCurrent: true });
    await upgrade(p, lawyer, scopeItems(["line.manage", "calls.read"]), ["calls.read"]);
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json()).toMatchObject({ linked: true, lineNumber: null, scopes: ["calls.read"] });
    // avocat-7 has no MIMT link: the partner's own roster, availability works as before.
    expect((await call("PUT", "/v1/partner/members/avocat-7/availability", p.h, { status: "busy" })).statusCode).toBe(200);
    expect((await call("GET", "/v1/partner/members/avocat-7", p.h)).json()).toMatchObject({ linked: false, scopes: [], consentVersion: null, consentCurrent: null });
  });
});

// ------------------------------------------------------------------------------------------- webhooks

describe("consent: webhooks follow the scopes", () => {
  it("not queued without the scope; consent changes are always told (scopes only)", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.place", "line.manage"]);
    const consent = events("member.consent_updated");
    expect(consent).toHaveLength(1);
    expect(Object.keys(consent[0]!.payload).sort()).toEqual(["consent_version", "member_external_id", "partner_id", "scopes", "updated_at"]);
    expect(consent[0]!.payload).toMatchObject({ member_external_id: "avocat-42", scopes: ["calls.place", "line.manage"] });
    expect(JSON.stringify(consent[0]!.payload)).not.toContain(lawyer.user.id);
    expect(events("member.linked")[0]!.payload).toMatchObject({ scopes: ["calls.place", "line.manage"] });

    // line.manage granted: member.number_changed goes out.
    await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" });
    expect(events("member.number_changed")).toHaveLength(1);
    // calls.place without calls.read: the call is placed, but its events are not sent.
    expect((await call("POST", "/v1/partner/members/avocat-42/calls", p.h, { to: "+14385550199" })).statusCode).toBe(201);
    expect(events("call.ringing")).toHaveLength(0);
    // availability.manage not granted: the person's own change is not reported.
    expect((await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: "busy" })).statusCode).toBe(200);
    expect(events("member.availability_changed")).toHaveLength(0);
    // Generic gate, for every scoped event type.
    const partner = (await ctx.repo.partners.getPartner(p.partnerId))!;
    for (const type of ["member.subscription_changed", "member.port_in_updated", "call.completed", "recording.ready"] as const) {
      expect(await emitPartnerEvent(ctx.deps, partner, type, { member_external_id: "avocat-42" }, { linkId: lawyer.linkId }), type).toBeNull();
    }
  });

  it("a scope removed after an event was queued stops its delivery", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["line.manage", "calls.read"]);
    await call("PUT", "/v1/partner/members/avocat-42/number", p.h, { e164: "+15145550177" });
    const queued = events("member.number_changed")[0]!;
    const removed = await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}/scopes/line.manage`, lawyer.auth);
    expect(removed.json()).toMatchObject({ unlinked: false, link: { scopes: ["calls.read"] } });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await deliverPartnerWebhooks(ctx.deps, { warn: () => undefined, error: () => undefined }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const sentTypes = (fetchImpl.mock.calls as unknown as Array<[string, { headers: Record<string, string> }]>).map(([, init]) => init.headers["x-mimt-event"]);
    expect(sentTypes).not.toContain("member.number_changed");
    expect(sentTypes).toContain("member.consent_updated");
    expect(await ctx.repo.partners.getEvent(queued.id)).toMatchObject({ deliveredAt: null, nextAttemptAt: null, lastError: "scope_not_granted" });
  });
});

// ------------------------------------------------------------------------------------- calls and recordings

describe("consent: calls and recordings answered under a link", () => {
  const ring = (p: P, sid: string) => twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: sid, From: "+14385550199", To: p.didNumber.e164 });
  async function answer(p: P, parentSid: string, externalId: string, legSid: string) {
    const m = await ctx.repo.partners.getMember(p.partnerId, externalId);
    return twilioPost(ctx, `/webhooks/twilio/pbx/whisper-input?b=${p.business.id}&x=${m!.extensionId}`, { CallSid: legSid, ParentCallSid: parentSid, Digits: "1" });
  }
  const record = (p: P, sid: string, rec: string) =>
    twilioPost(ctx, `/webhooks/twilio/pbx/recording?b=${p.business.id}&s=all`, {
      CallSid: sid,
      RecordingSid: rec,
      RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/${rec}`,
      RecordingStatus: "completed",
      RecordingDuration: "42",
    });
  const recordingOf = (sid: string) => ctx.repo.partners.calls.find((c) => c.callSid === sid)!.recordingId!;

  it("calls.read shows the record, recordings.read the recording; without them both stay hidden", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read", "line.manage"]);
    await ring(p, "CA1");
    await answer(p, "CA1", "avocat-42", "CA1-leg");
    await record(p, "CA1", "RE1");
    // Unlinked avocat-7 answers another call: the partner's own record, unaffected.
    await ring(p, "CA2");
    await answer(p, "CA2", "avocat-7", "CA2-leg");
    await record(p, "CA2", "RE2");
    expect(ctx.repo.partners.calls.find((c) => c.callSid === "CA1")!.linkId).toBe(lawyer.linkId);
    expect(events("call.answered").map((e) => e.payload.member_external_id).sort()).toEqual(["avocat-42", "avocat-7"]);
    // recording.ready only for the unlinked member's call.
    expect(events("recording.ready").map((e) => e.payload.member_external_id)).toEqual(["avocat-7"]);

    let calls = (await call("GET", "/v1/partner/calls", p.h)).json().calls as Array<{ externalId: string; recordingUrl: string | null }>;
    expect(calls.map((c) => [c.externalId, Boolean(c.recordingUrl)])).toEqual([
      ["avocat-42", false],
      ["avocat-7", true],
    ]);
    const denied = await call("GET", `/v1/partner/recordings/${recordingOf("CA1")}`, p.h);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "scope_not_granted", scope: "recordings.read" });
    expect((await call("GET", `/v1/partner/recordings/${recordingOf("CA2")}`, p.h)).statusCode).toBe(200);

    await upgrade(p, lawyer, scopeItems(["recordings.read"]));
    calls = (await call("GET", "/v1/partner/calls", p.h)).json().calls;
    expect(calls.map((c) => Boolean(c.recordingUrl))).toEqual([true, true]);
    expect((await call("GET", `/v1/partner/recordings/${recordingOf("CA1")}`, p.h)).statusCode).toBe(200);
    const log = (await call("GET", `/v1/me/partner-links/${lawyer.linkId}/access-log`, lawyer.auth)).json().entries as Array<{ scope: string; route: string }>;
    expect(log).toEqual(expect.arrayContaining([{ scope: "recordings.read", route: "GET /v1/partner/recordings/:id", outcome: "allowed", at: expect.any(String) }]));
    expect(log.some((e) => e.scope === "calls.read" && e.route === "GET /v1/partner/calls")).toBe(true);

    // calls.read removed: the record under the link disappears from the API and the owner's dashboard.
    await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}/scopes/calls.read`, lawyer.auth);
    calls = (await call("GET", "/v1/partner/calls", p.h)).json().calls;
    expect(calls.map((c) => c.externalId)).toEqual(["avocat-7"]);
    const owner = await call("GET", `/v1/business/${p.business.id}/partner`, p.owner.auth);
    expect(owner.json().calls.map((c: { externalId: string }) => c.externalId)).toEqual(["avocat-7"]);
    // Unlinked: still hidden (consent withdrawn, never shown again).
    await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}`, lawyer.auth);
    expect((await call("GET", "/v1/partner/calls", p.h)).json().calls.map((c: { externalId: string }) => c.externalId)).toEqual(["avocat-7"]);
  });
});

// ------------------------------------------------------------------------------------------- upgrades

describe("consent: re-consent when access changes (upgrade)", () => {
  it("the grant stays as approved until the same person approves the new scopes on /lier", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read"]);
    const r = await requestLink(p, scopeItems(["subscription.read", "porting.read"], ["subscription.read"]));
    expect(r.kind).toBe("upgrade");
    // Pending: nothing new yet.
    expect((await call("GET", "/v1/partner/members/avocat-42/subscription", p.h)).json().error).toBe("scope_not_granted");
    const preview = await call("POST", "/v1/me/partner-links/preview", lawyer.auth, { code: r.code, requestId: r.requestId });
    expect(preview.json()).toMatchObject({
      kind: "upgrade",
      currentScopes: ["calls.read"],
      scopes: [
        { scope: "subscription.read", required: true, granted: false },
        { scope: "porting.read", required: false, granted: false },
      ],
    });
    const res = await approve(lawyer.auth, r, ["subscription.read"]);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: lawyer.linkId, scopes: ["calls.read", "subscription.read"], requiredScopes: ["subscription.read"] });
    expect((await call("GET", "/v1/partner/members/avocat-42/subscription", p.h)).statusCode).toBe(200);
    expect((await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h)).json()).toMatchObject({ error: "scope_not_granted", scope: "porting.read" });
    expect(events("member.consent_updated").at(-1)!.payload).toMatchObject({ scopes: ["calls.read", "subscription.read"] });
    expect(events("member.linked")).toHaveLength(1);
    const receipts = (await call("GET", `/v1/me/partner-links/${lawyer.linkId}/receipts`, lawyer.auth)).json().receipts;
    expect(receipts.map((x: { action: string }) => x.action)).toEqual(["upgraded", "granted"]);
    expect(receipts[0]).toMatchObject({ changed: ["subscription.read"], scopes: ["calls.read", "subscription.read"] });
    // An upgrade that mentions a granted scope and leaves it unchecked removes it.
    await upgrade(p, lawyer, scopeItems(["calls.read", "porting.read"]), ["porting.read"]);
    expect((await myLinks(lawyer.auth))[0]!.scopes).toEqual(["subscription.read", "porting.read"]);
  });

  it("an older consent text keeps its grant and is flagged for re-consent", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read"]);
    const link = ctx.repo.partners.links.find((l) => l.id === lawyer.linkId)!;
    link.consentVersion = PARTNER_LEGACY_CONSENT_VERSION;
    expect((await myLinks(lawyer.auth))[0]).toMatchObject({ consentCurrent: false, scopes: ["calls.read"] });
    expect((await call("GET", "/v1/partner/members/avocat-42", p.h)).json()).toMatchObject({ consentCurrent: false, consentVersion: PARTNER_LEGACY_CONSENT_VERSION });
    expect((await call("GET", "/v1/partner/calls", p.h)).statusCode).toBe(200);
    await upgrade(p, lawyer, scopeItems(["calls.read"]));
    expect((await myLinks(lawyer.auth))[0]).toMatchObject({ consentCurrent: true, consentVersion: PARTNER_CONSENT_TEXT_VERSION });
  });
});

// ------------------------------------------------------------------------------------------- receipts

describe("consent: receipts", () => {
  it("scopes, versions, time, coarse device and network; never the full IP or user agent; notified", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read", "line.manage"]);
    const [link] = await myLinks(lawyer.auth);
    expect(link).toMatchObject({ partnerLegalName: "BesoinAvocat inc.", privacyContactEmail: "vieprivee@besoinavocat.ca", consentedAt: now.toISOString() });
    expect(link!.receipt).toEqual({
      id: expect.any(String),
      action: "granted",
      actor: "user",
      scopes: ["calls.read", "line.manage"],
      changed: ["calls.read", "line.manage"],
      requiredScopes: [],
      purposes: { "calls.read": purposeOf("calls.read"), "line.manage": purposeOf("line.manage") },
      consentVersion: PARTNER_CONSENT_TEXT_VERSION,
      scopeSetVersion: PARTNER_SCOPE_SET_VERSION,
      termsVersion: PARTNER_TERMS_VERSION,
      device: "Chrome · Windows",
      network: "203.0.113.0/24",
      createdAt: now.toISOString(),
    });
    const stored = JSON.stringify(ctx.repo.partners.receipts);
    expect(stored).not.toContain("203.0.113.57");
    expect(stored).not.toContain("Chrome/131");
    expect(JSON.stringify(ctx.repo.auditLog.filter((a) => a.action.startsWith("partner.")).map((a) => a.meta))).not.toContain("203.0.113.57");
    expect(ctx.notifier.sent).toContainEqual([lawyer.user.id, "partner_consent_receipt", { partner: "BesoinAvocat", action: "granted" }]);
    // IPv6: a /48 only.
    const other = await makeUser(ctx);
    const r = await requestLink(p, scopeItems(["calls.read"]), "avocat-7");
    expect((await approve(other.auth, r, ["calls.read"], { remote: "2001:db8:abcd:12:34::9" })).statusCode).toBe(201);
    expect((await myLinks(other.auth))[0]!.receipt).toMatchObject({ network: "2001:db8:abcd::/48" });
  });

  it("the push notice names the partner only (no ids, no scopes' data)", () => {
    const fr = pushPayload("partner_consent_receipt", { partner: "BesoinAvocat", action: "granted" }, "fr-CA")!;
    expect(fr).toMatchObject({ title: "Reçu de consentement MIMT Connect", url: "/compte/integrations" });
    expect(fr.body).toContain("BesoinAvocat");
    const odd = pushPayload("partner_consent_receipt", { partner: "<script>x</script>", action: "revoked" }, "en-CA")!;
    expect(odd.body).not.toContain("script");
    expect(odd.body).toContain("removed");
  });
});

// ------------------------------------------------------------------------------------------- per-scope revoke

describe("consent: per-scope revoke", () => {
  it("removes one scope at once (required ones too); availability.manage removal clears the partner's setting; the last one unlinks", async () => {
    const p = await makePartner();
    const lawyer = makeUser(ctx, { number: "+15145550177" });
    const r = await requestLink(p, scopeItems(["availability.manage", "calls.read"], ["calls.read"]));
    const l = await lawyer;
    expect((await approve(l.auth, r, ["availability.manage", "calls.read"])).statusCode).toBe(201);
    const linkId = (await myLinks(l.auth))[0]!.id as string;
    expect((await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "busy" })).json()).toMatchObject({ effectiveStatus: "busy" });

    expect((await call("DELETE", `/v1/me/partner-links/${linkId}/scopes/calls.write`, l.auth)).statusCode).toBe(400);
    expect((await call("DELETE", `/v1/me/partner-links/${linkId}/scopes/porting.read`, l.auth)).json().error).toBe("scope_not_granted");
    const res = await call("DELETE", `/v1/me/partner-links/${linkId}/scopes/availability.manage`, l.auth);
    expect(res.json()).toMatchObject({ unlinked: false, link: { scopes: ["calls.read"], requiredScopes: ["calls.read"] } });
    const m = await ctx.repo.partners.getMember(p.partnerId, "avocat-42");
    expect(await ctx.repo.partners.getAvailability(m!.id)).toMatchObject({ status: "available", weekly: null, until: null });
    expect((await call("GET", "/v1/partner/members/avocat-42/availability", p.h)).json().scope).toBe("availability.manage");

    // A required scope can still be removed: the partner is told and decides. It was the last one: unlinked.
    const last = await call("DELETE", `/v1/me/partner-links/${linkId}/scopes/calls.read`, l.auth);
    expect(last.json()).toEqual({ unlinked: true, link: null });
    expect(await myLinks(l.auth)).toEqual([]);
    expect(events("member.unlinked")[0]!.payload).toMatchObject({ member_external_id: "avocat-42", by: "user" });
    const receipts = await ctx.repo.partners.listConsentReceipts(linkId, 10);
    expect(receipts.map((x) => [x.action, x.scopes])).toEqual([
      ["revoked", []],
      ["scope_revoked", ["calls.read"]],
      ["granted", ["calls.read", "availability.manage"]],
    ]);
    // Someone else's link: 404.
    const stranger = await makeUser(ctx);
    expect((await call("DELETE", `/v1/me/partner-links/${linkId}/scopes/calls.read`, stranger.auth)).statusCode).toBe(404);
    expect((await call("GET", `/v1/me/partner-links/${linkId}/access-log`, stranger.auth)).statusCode).toBe(404);
    // The person can still read what happened after the unlink.
    expect((await call("GET", `/v1/me/partner-links/${linkId}/receipts`, l.auth)).json().receipts).toHaveLength(3);
  });

  it("the partner's own unlink leaves a receipt without a device or network", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read"]);
    expect((await call("DELETE", "/v1/partner/members/avocat-42/link", p.h)).statusCode).toBe(204);
    const [last] = await ctx.repo.partners.listConsentReceipts(lawyer.linkId, 1);
    expect(last).toMatchObject({ action: "revoked", actor: "partner", device: null, network: null, scopes: [] });
  });
});

// ------------------------------------------------------------------------------------------- access log

describe("consent: access log", () => {
  it("the latest 50, newest first; entries older than 90 days are deleted by the daily job", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["subscription.read"]);
    for (let i = 0; i < 55; i++) {
      expect((await call("GET", "/v1/partner/members/avocat-42/subscription?x=1", p.h)).statusCode).toBe(200);
      advance(1);
    }
    const log = (await call("GET", `/v1/me/partner-links/${lawyer.linkId}/access-log`, lawyer.auth)).json().entries as Array<{ at: string; route: string }>;
    expect(log).toHaveLength(50);
    expect(new Date(log[0]!.at).getTime()).toBeGreaterThan(new Date(log[49]!.at).getTime());
    expect(log[0]!.route).toBe("GET /v1/partner/members/:externalId/subscription");
    // Nothing older than 90 days survives the job; newer entries stay.
    advance(89 * 86_400);
    expect(await runPartnerAccessLogRetention(ctx.deps)).toEqual({ deleted: 0 });
    advance(2 * 86_400);
    expect(await runPartnerAccessLogRetention(ctx.deps)).toEqual({ deleted: 55 });
    expect(ctx.repo.partners.accessLog).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------- kill switch

describe("consent: kill switch", () => {
  it("PARTNERS=off answers 404 on every new route", async () => {
    const p = await makePartner();
    const lawyer = await lawyerWith(p, ["calls.read"]);
    ctx.deps.config.PARTNERS = "off";
    const routes: Array<[Method, string, Record<string, string>]> = [
      ["GET", "/v1/partner/consent-text", p.h],
      ["POST", `/v1/admin/partners/${p.partnerId}/terms-acceptance`, p.admin.auth],
      ["DELETE", `/v1/me/partner-links/${lawyer.linkId}/scopes/calls.read`, lawyer.auth],
      ["GET", `/v1/me/partner-links/${lawyer.linkId}/access-log`, lawyer.auth],
      ["GET", `/v1/me/partner-links/${lawyer.linkId}/receipts`, lawyer.auth],
    ];
    for (const [method, url, headers] of routes) {
      const res = await ctx.app.inject({ method, url, headers, ...(method === "POST" ? { payload: termsBody() } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await myLinksRaw(lawyer.auth)).statusCode).toBe(404);
  });
  const myLinksRaw = (auth: Record<string, string>) => call("GET", "/v1/me/partner-links", auth);
});

// ------------------------------------------------------------------------------------------- migration 0029

describe("consent: migration of links approved before scopes (0029)", () => {
  const sql = readFileSync(join(__dirname, "../../../supabase/migrations/0029_partner_consent.sql"), "utf8");

  it("lot A links get exactly the lot A scopes; lot B scopes and recordings are not granted (always ask)", () => {
    const update = /update partner_member_links\s+set scopes = array\[([^\]]+)\]::text\[\],\s+consent_version = '([^']+)'/.exec(sql);
    expect(update).not.toBeNull();
    const scopes = update![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(scopes).toEqual([...PARTNER_LEGACY_SCOPES]);
    expect(scopes).toEqual(["calls.read", "calls.place", "line.manage"]);
    for (const lotB of ["subscription.read", "porting.read", "availability.manage", "recordings.read"]) expect(scopes).not.toContain(lotB);
    expect(update![2]).toBe(PARTNER_LEGACY_CONSENT_VERSION);
    // A « migrated » receipt for each active link, and pending scope-less codes are voided.
    expect(sql).toMatch(/'migrated', 'system'/);
    expect(sql).toMatch(/update partner_link_requests set invalidated_at = now\(\) where used_at is null and invalidated_at is null/);
  });

  it("the scope names in SQL checks match the shared catalogue", () => {
    for (const s of PARTNER_SCOPES) expect(sql).toContain(`'${s}'`);
    const check = /check \(scopes <@ array\[([^\]]+)\]::text\[\]\)/.exec(sql)!;
    expect(check[1]!.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...PARTNER_SCOPES]);
  });
});
