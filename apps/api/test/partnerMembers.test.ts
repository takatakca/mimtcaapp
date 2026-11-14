// « MIMT Connect » lot B (issue #97, points 3, 4 and 7; docs/MIMT-CONNECT.md « Statut du membre »): subscription and
// port-in status of the linked person (link required, minimal fields, webhooks on change only), availability
// (schedule, until, the person's own override) and hunt groups skipping unavailable members, kill switch.
import twilio from "twilio";
import { DEFAULT_WEEKLY_SCHEDULE, type NumberPortIn, type WeeklySchedule } from "@mimt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { BillingGateway } from "../src/gateways/billing.js";
import type { PortInSnapshot, TwilioPortingGateway } from "../src/gateways/twilioPorting.js";
import { dialRingGroup, type PbxSnapshot } from "../src/pbx/router.js";
import { effectiveAvailability } from "../src/services/partnerMembers.js";
import type { PartnerAvailabilityRow } from "../src/repo/partners.js";
import { AUTH_TOKEN, BASE_URL, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";
import { acceptTerms, approveBody, scopeItems } from "./partnerConsentFixtures.js";

let ctx: Ctx;
let now: Date;
// Friday 30 October 2026, 11:00 in Montréal (EDT).
const START = new Date("2026-10-30T15:00:00Z");
const PORT_SID = "KW" + "0123456789abcdef".repeat(2);
const PORTED = "+14505550123";
const ACCOUNT_NUMBER = "ACCT-998877-SECRET";
const PIN = "4321";

function fakePorting() {
  const state: { snapshot: PortInSnapshot | null } = { snapshot: null };
  const gw = {
    checkPortability: vi.fn(async () => ({ portable: true, reason: null, pinAndAccountNumberRequired: false })),
    createPortIn: vi.fn(async () => ({ sid: PORT_SID })),
    getPortIn: vi.fn(async (sid: string) => state.snapshot ?? { sid, status: "In progress", numbers: [] }),
    cancelPortIn: vi.fn(async () => {}),
    configurePortedNumber: vi.fn(async () => ({ sid: "PNported1" })),
  } satisfies TwilioPortingGateway;
  return { gw, state };
}
let porting: ReturnType<typeof fakePorting>;

beforeEach(async () => {
  now = new Date(START);
  ctx = await setup({ config: { PARTNERS: "on", PARTNER_CREDIT_PER_MINUTE: "2" }, now: () => now });
  porting = fakePorting();
  ctx.deps.porting = porting.gw;
  ctx.deps.billing = {
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (!Buffer.isBuffer(raw) || sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
  } as unknown as BillingGateway;
});
afterEach(() => ctx.app.close());

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const events = (type?: string) => ctx.repo.partners.events.filter((e) => !type || e.eventType === type);

/** Partner « BesoinAvocat » with a key, a webhook and two members on cellphones. */
async function makePartner() {
  const biz = await makeBusiness(ctx);
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  const created = await call("POST", "/v1/admin/partners", admin.auth, { businessId: biz.business.id, name: "BesoinAvocat", slug: "besoinavocat" });
  const partnerId = created.json().id as string;
  const k = await call("POST", `/v1/admin/partners/${partnerId}/keys`, admin.auth, { label: "portail" });
  await call("PUT", `/v1/admin/partners/${partnerId}/webhook`, admin.auth, { url: "https://portail.besoinavocat.ca/api/mimt/webhook" });
  await acceptTerms(ctx, admin.auth, partnerId);
  const h = bearer(k.json().key as string);
  expect((await call("PUT", "/v1/partner/members/avocat-42", h, { name: "Me Tremblay", phone: "+15145550142" })).statusCode).toBe(201);
  expect((await call("PUT", "/v1/partner/members/avocat-7", h, { name: "Me Roy", phone: "+15145550107" })).statusCode).toBe(201);
  return { ...biz, admin, partnerId, h };
}
type P = Awaited<ReturnType<typeof makePartner>>;

/** A lawyer with their own MIMT account, linked to `externalId` with their consent (lot A). */
async function linkedLawyer(p: P, externalId = "avocat-42", number = "+15145550177") {
  const lawyer = await makeUser(ctx, { e911: true, ack: true, number });
  const r = (await call("POST", `/v1/partner/members/${externalId}/link-requests`, p.h, { scopes: scopeItems() })).json();
  const res = await call("POST", "/v1/me/partner-links/approve", lawyer.auth, approveBody(r));
  expect(res.statusCode, res.body).toBe(201);
  return { ...lawyer, linkId: res.json().id as string };
}

const stripeSub = (accountId: string, status: string, eventId: string, code = "premium") =>
  call(
    "POST",
    "/webhooks/stripe",
    { "content-type": "application/json", "stripe-signature": "good" },
    JSON.stringify({
      id: eventId,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_lawyer",
          customer: "cus_lawyer",
          status,
          metadata: { telecom_account_id: accountId, kind: "plan", code },
          items: { data: [{ quantity: 1, current_period_end: 1_800_000_000, price: { unit_amount: 2999, recurring: { interval: "month" } } }] },
        },
      },
    }),
  );

// ---------------------------------------------------------------------------------------------- kill switch

describe("lot B: kill switch", () => {
  it("PARTNERS=off answers 404 on every new route, and the hooks send nothing", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    ctx.deps.config.PARTNERS = "off";
    const routes: Array<[Method, string, Record<string, string>]> = [
      ["GET", "/v1/partner/members/avocat-42/subscription", p.h],
      ["GET", "/v1/partner/members/avocat-42/port-ins", p.h],
      ["GET", "/v1/partner/members/avocat-42/availability", p.h],
      ["PUT", "/v1/partner/members/avocat-42/availability", p.h],
      ["PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth],
    ];
    for (const [method, url, headers] of routes) {
      const res = await ctx.app.inject({ method, url, headers, ...(method === "GET" ? {} : { payload: { status: "busy" } }) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error).toBe("not_found");
    }
    const before = events().length;
    expect((await stripeSub(lawyer.account.id, "active", "evt_off")).statusCode).toBe(200);
    expect(events()).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------------------------- subscription

describe("lot B: subscription status of the linked person", () => {
  it("requires an active link (409 with the choose-number link), 404 for an unknown member", async () => {
    const p = await makePartner();
    const res = await call("GET", "/v1/partner/members/avocat-42/subscription", p.h);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "member_not_linked" });
    expect((await call("GET", "/v1/partner/members/ghost/subscription", p.h)).statusCode).toBe(404);
    expect((await call("GET", "/v1/partner/members/avocat-42/subscription", bearer("mimt_pk_nope"))).statusCode).toBe(401);
  });

  it("returns a minimal view (plan, status, period end, can call, planUrl) and nothing about money", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    const free = await call("GET", "/v1/partner/members/avocat-42/subscription", p.h);
    expect(free.json()).toEqual({ plan: "free", status: "none", currentPeriodEnd: null, canCall: true, planUrl: "https://app.mimt.ca/compte?partner=besoinavocat#forfait" });

    await stripeSub(lawyer.account.id, "trialing", "evt_1");
    const body = (await call("GET", "/v1/partner/members/avocat-42/subscription", p.h)).json();
    expect(body).toEqual({
      plan: "premium",
      status: "trialing",
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      canCall: true,
      planUrl: "https://app.mimt.ca/compte?partner=besoinavocat#forfait",
    });
    expect(JSON.stringify(body)).not.toMatch(/amount|card|invoice|cus_|sub_|2999/);

    // Suspended account: cannot place or receive calls.
    await ctx.repo.updateAccount(lawyer.account.id, { status: "SUSPENDED" });
    expect((await call("GET", "/v1/partner/members/avocat-42/subscription", p.h)).json().canCall).toBe(false);

    // Canceled: back to free, status canceled.
    await ctx.repo.updateAccount(lawyer.account.id, { status: "ACTIVE_INDEPENDENT" });
    await stripeSub(lawyer.account.id, "canceled", "evt_2");
    expect((await call("GET", "/v1/partner/members/avocat-42/subscription", p.h)).json()).toMatchObject({ plan: "free", status: "canceled" });
  });

  it("member.subscription_changed on each plan or status change only, for linked people only", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    const stranger = await makeUser(ctx);
    await stripeSub(stranger.account.id, "active", "evt_s");
    expect(events("member.subscription_changed")).toHaveLength(0);

    await stripeSub(lawyer.account.id, "active", "evt_1");
    await stripeSub(lawyer.account.id, "active", "evt_2"); // same view: nothing new
    await stripeSub(lawyer.account.id, "past_due", "evt_3");
    await stripeSub(lawyer.account.id, "active", "evt_4", "business");
    const sent = events("member.subscription_changed").map((e) => e.payload);
    expect(sent).toEqual([
      expect.objectContaining({ member_external_id: "avocat-42", plan: "premium", status: "active", can_call: true }),
      expect.objectContaining({ plan: "premium", status: "past_due" }),
      expect.objectContaining({ plan: "business", status: "active", current_period_end: new Date(1_800_000_000 * 1000).toISOString() }),
    ]);
    for (const e of sent) expect(JSON.stringify(e)).not.toMatch(/amount|card|invoice|cus_|sub_lawyer|2999|telecom_account|user_id/);
    expect(JSON.stringify(sent)).not.toContain(lawyer.user.id);

    // After unlinking, nothing goes to the partner any more.
    await call("DELETE", "/v1/partner/members/avocat-42/link", p.h);
    await stripeSub(lawyer.account.id, "canceled", "evt_5");
    expect(events("member.subscription_changed")).toHaveLength(3);
  });
});

// -------------------------------------------------------------------------------------------------- port-ins

const portBody = (temporaryNumber: string) => ({
  temporaryNumber,
  numbers: [PORTED],
  currentCarrier: "Bell Canada",
  customerType: "individual",
  customerName: "Julie Tremblay",
  authorizedName: "Julie Tremblay",
  authorizedEmail: "julie@example.ca",
  accountNumber: ACCOUNT_NUMBER,
  pin: PIN,
  desiredDate: "2026-11-20",
  serviceAddress: { street: "1 rue Sainte-Catherine", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4" },
});

function portingWebhook() {
  const raw = JSON.stringify({ port_in_request_sid: PORT_SID });
  const path = `/webhooks/twilio/porting?bodySHA256=${twilio.getExpectedBodyHash(raw)}`;
  const sig = twilio.getExpectedTwilioSignature(AUTH_TOKEN, BASE_URL + path, {});
  return ctx.app.inject({ method: "POST", url: path, headers: { "content-type": "application/json", "x-twilio-signature": sig }, payload: raw });
}

describe("lot B: number transfers of the linked person", () => {
  it("requires an active link", async () => {
    const p = await makePartner();
    const res = await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("member_not_linked");
  });

  it("lists minimal fields (never the account number or PIN) and sends member.port_in_updated on each change", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    const empty = (await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h)).json();
    expect(empty).toEqual({ portIns: [], portUrl: "https://app.mimt.ca/services/transfert?partner=besoinavocat" });

    const created = await call("POST", "/v1/port-ins", lawyer.auth, portBody("+15145550177"));
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as NumberPortIn).id;
    const signed = await call("POST", `/v1/port-ins/${id}/sign`, { ...lawyer.auth, "user-agent": "vitest" }, { signedName: "Julie Tremblay", accept: true });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(events("member.port_in_updated").map((e) => e.payload)).toEqual([
      expect.objectContaining({ member_external_id: "avocat-42", port_in_id: id, e164: PORTED, status: "submitted", expected_date: "2026-11-20" }),
    ]);

    const list = (await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h)).json();
    expect(list.portIns).toEqual([
      { id, e164: PORTED, numbers: [{ e164: PORTED, status: "submitted" }], status: "submitted", updatedAt: expect.any(String), expectedDate: "2026-11-20" },
    ]);
    const all = JSON.stringify([list, events("member.port_in_updated")]);
    for (const secret of [ACCOUNT_NUMBER, PIN, "Bell Canada", "Sainte-Catherine", "julie@example.ca", "Julie Tremblay", lawyer.user.id]) expect(all).not.toContain(secret);

    // Twilio: the losing carrier confirmed a date. Then the same snapshot again: nothing new.
    porting.state.snapshot = { sid: PORT_SID, status: "In progress", numbers: [{ e164: PORTED, status: "Port Date Set", portDate: "2026-11-18", rejectionReason: null }] };
    expect((await portingWebhook()).statusCode).toBe(200);
    expect((await portingWebhook()).statusCode).toBe(200);
    const sent = events("member.port_in_updated");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload).toMatchObject({ status: "foc_scheduled", expected_date: "2026-11-18", numbers: [{ e164: PORTED, status: "foc_scheduled" }] });
    expect((await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h)).json().portIns[0]).toMatchObject({ status: "foc_scheduled", expectedDate: "2026-11-18" });
  });

  it("someone else's transfer is never reported", async () => {
    const p = await makePartner();
    await linkedLawyer(p);
    const other = await makeUser(ctx, { e911: true, ack: true, number: "+15145550188" });
    expect((await call("POST", "/v1/port-ins", other.auth, portBody("+15145550188"))).statusCode).toBe(201);
    expect((await call("GET", "/v1/partner/members/avocat-42/port-ins", p.h)).json().portIns).toEqual([]);
    expect(events("member.port_in_updated")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------- availability

const row = (fields: Partial<PartnerAvailabilityRow>): PartnerAvailabilityRow => ({
  memberId: "m",
  partnerId: "p",
  status: "available",
  weekly: null,
  until: null,
  userStatus: null,
  createdAt: START,
  updatedAt: START,
  ...fields,
});

describe("lot B: availability rules", () => {
  it("default available; the partner's status until `until`; weekly windows in Montréal time; the person's status wins", () => {
    expect(effectiveAvailability(null, START)).toEqual({ status: "available", source: "default" });
    expect(effectiveAvailability(row({ status: "busy" }), START)).toEqual({ status: "busy", source: "partner" });
    const until = new Date(START.getTime() + 3600_000);
    expect(effectiveAvailability(row({ status: "busy", until }), START).status).toBe("busy");
    expect(effectiveAvailability(row({ status: "busy", until }), until)).toEqual({ status: "available", source: "default" });
    // Mon-Fri 9-17 Montréal: Friday 11:00 is in, Friday 18:30 (22:30Z) and Saturday are out.
    const weekly = DEFAULT_WEEKLY_SCHEDULE;
    expect(effectiveAvailability(row({ weekly }), START).status).toBe("available");
    expect(effectiveAvailability(row({ weekly }), new Date("2026-10-30T22:30:00Z"))).toEqual({ status: "offline", source: "schedule" });
    expect(effectiveAvailability(row({ weekly }), new Date("2026-10-31T15:00:00Z")).status).toBe("offline");
    // 8:59 is out, 9:00 is in (EDT = UTC-4).
    expect(effectiveAvailability(row({ weekly }), new Date("2026-10-30T12:59:00Z")).status).toBe("offline");
    expect(effectiveAvailability(row({ weekly }), new Date("2026-10-30T13:00:00Z")).status).toBe("available");
    // The person's own status replaces the partner's (and its until); the schedule still bounds « available ».
    expect(effectiveAvailability(row({ status: "available", userStatus: "busy" }), START)).toEqual({ status: "busy", source: "user" });
    expect(effectiveAvailability(row({ status: "offline", userStatus: "available" }), START)).toEqual({ status: "available", source: "user" });
    expect(effectiveAvailability(row({ status: "offline", userStatus: "available", weekly }), new Date("2026-10-31T15:00:00Z")).source).toBe("schedule");
  });
});

describe("lot B: availability API", () => {
  it("GET default, PUT validates and replaces, member.availability_changed only on change", async () => {
    const p = await makePartner();
    const def = (await call("GET", "/v1/partner/members/avocat-42/availability", p.h)).json();
    expect(def).toEqual({ externalId: "avocat-42", status: "available", weekly: null, until: null, userStatus: null, effectiveStatus: "available", source: "default", updatedAt: null });

    const bad: Array<[unknown, number, string]> = [
      [{ status: "away" }, 400, "invalid_request"],
      [{ status: "busy", until: "2026-10-30T14:00:00Z" }, 400, "until_in_past"],
      [{ status: "busy", until: "2028-01-01T00:00:00Z" }, 400, "until_too_far"],
      [{ status: "busy", weekly: { mon: [{ open: "17:00", close: "09:00" }] } }, 400, "invalid_request"],
      [{ status: "busy", extra: 1 }, 400, "invalid_request"],
    ];
    for (const [body, code, error] of bad) {
      const res = await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(code);
      expect(res.json().error).toBe(error);
    }
    expect((await call("PUT", "/v1/partner/members/ghost/availability", p.h, { status: "busy" })).statusCode).toBe(404);

    const until = "2026-10-30T17:00:00.000Z";
    const busy = await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "busy", until });
    expect(busy.statusCode).toBe(200);
    expect(busy.json()).toMatchObject({ status: "busy", until, effectiveStatus: "busy", source: "partner" });
    await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "busy", until }); // same: no event
    const weekly: WeeklySchedule = DEFAULT_WEEKLY_SCHEDULE;
    const sched = await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "available", weekly });
    expect(sched.json()).toMatchObject({ status: "available", until: null, weekly, effectiveStatus: "available" });
    const sent = events("member.availability_changed").map((e) => e.payload);
    expect(sent).toEqual([
      expect.objectContaining({ member_external_id: "avocat-42", effective_status: "busy", partner_status: "busy", until, changed_by: "partner" }),
      expect.objectContaining({ effective_status: "available", has_schedule: true, until: null, changed_by: "partner" }),
    ]);
    // Saturday: outside the windows.
    now = new Date("2026-10-31T15:00:00Z");
    expect((await call("GET", "/v1/partner/members/avocat-42/availability", p.h)).json()).toMatchObject({ effectiveStatus: "offline", source: "schedule" });
    expect(ctx.repo.auditLog.filter((a) => a.action === "partner.member_availability_set")).toHaveLength(2);
  });

  it("the linked person sets their own status in the webphone; it wins over the partner's, null hands it back", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "available" });

    const mine = await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: "busy" });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ externalId: "avocat-42", userStatus: "busy", effectiveStatus: "busy" });
    expect((await call("GET", "/v1/me/partner-links", lawyer.auth)).json().links[0]).toMatchObject({ userStatus: "busy", effectiveStatus: "busy" });
    // The partner sets « available » again: the person's status still wins.
    await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "offline" });
    await call("PUT", "/v1/partner/members/avocat-42/availability", p.h, { status: "available" });
    expect((await call("GET", "/v1/partner/members/avocat-42/availability", p.h)).json()).toMatchObject({ status: "available", userStatus: "busy", effectiveStatus: "busy", source: "user" });

    const back = await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: null });
    expect(back.json()).toMatchObject({ userStatus: null, effectiveStatus: "available" });
    const byUser = events("member.availability_changed").filter((e) => e.payload.changed_by === "user");
    expect(byUser.map((e) => e.payload.effective_status)).toEqual(["busy", "available"]);
    expect(JSON.stringify(byUser)).not.toContain(lawyer.user.id);

    // Someone else's link, a revoked link, a bad status.
    const other = await makeUser(ctx);
    expect((await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, other.auth, { status: "busy" })).statusCode).toBe(404);
    expect((await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: "away" })).statusCode).toBe(400);
    await call("DELETE", `/v1/me/partner-links/${lawyer.linkId}`, lawyer.auth);
    expect((await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: "busy" })).statusCode).toBe(404);
  });
});

// --------------------------------------------------------------------------------------------- hunt groups

async function hunt(p: P, strategy: "simultaneous" | "sequential") {
  const res = await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", p.h, { members: ["avocat-42", "avocat-7"], strategy, ringTimeoutS: 20, did: p.didNumber.e164 });
  expect(res.statusCode).toBe(201);
}
const ring = (p: P, sid: string) => twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: sid, From: "+14385550199", To: p.didNumber.e164 });
const setAvail = (p: P, externalId: string, body: object) => call("PUT", `/v1/partner/members/${externalId}/availability`, p.h, body);

describe("lot B: hunt groups skip unavailable members", () => {
  it("simultaneous: only available members ring", async () => {
    const p = await makePartner();
    await hunt(p, "simultaneous");
    await setAvail(p, "avocat-42", { status: "busy" });
    const twiml = (await ring(p, "CA1")).body;
    expect(twiml).toContain("+15145550107");
    expect(twiml).not.toContain("+15145550142");
  });

  it("sequential: an unavailable member is passed over, at the first step and after a no-answer", async () => {
    const p = await makePartner();
    await hunt(p, "sequential");
    await setAvail(p, "avocat-42", { status: "offline" });
    const first = (await ring(p, "CA2")).body;
    expect(first).toContain("+15145550107");
    expect(first).not.toContain("+15145550142");
    expect(first).toMatch(/dial-result\?[^"]*i=1/);

    // avocat-42 available again, avocat-7 now busy: after avocat-42 does not answer (step 0), avocat-7 is skipped.
    await setAvail(p, "avocat-42", { status: "available" });
    await setAvail(p, "avocat-7", { status: "busy" });
    const group = ctx.repo.partners.huntGroups[0]!.ringGroupId;
    const next = await twilioPost(ctx, `/webhooks/twilio/pbx/dial-result?b=${p.business.id}&n=${p.didNumber.id}&k=rg&id=${group}&i=0`, {
      CallSid: "CA3",
      DialCallStatus: "no-answer",
    });
    expect(next.body).not.toContain("<Dial");
    expect(next.body).toContain("<Record");
  });

  it("nobody available: straight to the group's voicemail (or its goodbye), nobody rung, the caller is never dropped silently", async () => {
    const p = await makePartner();
    await hunt(p, "simultaneous");
    await setAvail(p, "avocat-42", { status: "busy" });
    await setAvail(p, "avocat-7", { status: "available", weekly: { ...DEFAULT_WEEKLY_SCHEDULE, fri: [] } });
    const vm = (await ring(p, "CA4")).body;
    expect(vm).not.toContain("<Dial");
    expect(vm).toContain("<Record");
    expect(vm).toContain("Laissez votre message");
    // The call is still tracked for the partner.
    expect(events("call.ringing")).toHaveLength(1);

    await call("PUT", "/v1/partner/hunt-groups/trouver-un-avocat", p.h, { members: ["avocat-42", "avocat-7"], strategy: "simultaneous", fallback: "hangup", did: p.didNumber.e164 });
    const bye = (await ring(p, "CA5")).body;
    expect(bye).not.toContain("<Dial");
    expect(bye).toContain("Merci d'avoir appelé");
  });

  it("the person's own « available » makes them ring even when the partner set them busy", async () => {
    const p = await makePartner();
    const lawyer = await linkedLawyer(p);
    await hunt(p, "simultaneous");
    await setAvail(p, "avocat-42", { status: "busy" });
    expect((await ring(p, "CA6")).body).not.toContain(`<Client`);
    await call("PUT", `/v1/me/partner-links/${lawyer.linkId}/availability`, lawyer.auth, { status: "available" });
    expect((await ring(p, "CA7")).body).toContain(`>${lawyer.user.id}</Client>`);
  });

  it("with PARTNERS=off, or a suspended partner, every member rings exactly as before", async () => {
    const p = await makePartner();
    await hunt(p, "simultaneous");
    await setAvail(p, "avocat-42", { status: "offline" });
    await setAvail(p, "avocat-7", { status: "busy" });
    ctx.deps.config.PARTNERS = "off";
    const off = (await ring(p, "CA8")).body;
    expect(off).toContain("+15145550142");
    expect(off).toContain("+15145550107");
    ctx.deps.config.PARTNERS = "on";
    await call("PATCH", `/v1/admin/partners/${p.partnerId}`, p.admin.auth, { status: "suspended" });
    const suspended = (await ring(p, "CA9")).body;
    expect(suspended).toContain("+15145550142");
    expect(suspended).toContain("+15145550107");
  });

  it("non-partner businesses: the router output is byte-identical without the field or with an empty list", () => {
    const ext = (id: string, phone: string) => ({
      id,
      businessId: "b",
      number: id === "e1" ? "101" : "102",
      userId: null,
      displayName: id,
      voicemail: { enabled: true, greeting: null },
      forwardToMobile: phone,
      did: null,
      ringTimeoutS: 20,
      createdAt: START,
      updatedAt: START,
    });
    const group = { id: "g", businessId: "b", name: "G", number: null, strategy: "sequential" as const, memberExtensionIds: ["e1", "e2"], timeoutS: 20, overflow: null, createdAt: START };
    const snap = {
      business: { id: "b", name: "Café", recordingPolicy: { mode: "off", consentPrompt: { fr: "", en: "" }, retentionDays: 90 } },
      extensions: [ext("e1", "+15145550142"), ext("e2", "+15145550107")],
      ringGroups: [group],
      ivrMenus: [],
      hours: null,
      canRecord: false,
      transcribe: false,
    } as unknown as PbxSnapshot;
    const ctxOf = (s: PbxSnapshot) => ({ snap: s, now: START, base: BASE_URL, numberId: "n" });
    for (const strategy of ["sequential", "simultaneous"] as const) {
      const g = { ...group, strategy };
      const s = { ...snap, ringGroups: [g] } as PbxSnapshot;
      for (const i of [0, 1, 2]) {
        const plain = dialRingGroup(ctxOf(s), g, i).toString();
        expect(dialRingGroup(ctxOf({ ...s, unavailableExtensionIds: [] }), g, i).toString()).toBe(plain);
      }
    }
  });
});
