import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidExtension, DEFAULT_RECORDING_POLICY, DEFAULT_WEEKLY_SCHEDULE, quebecStatutoryHolidays, type BusinessHours, type RouteTarget } from "@mimt/shared";
import * as router from "../src/pbx/router.js";
import type { ExtensionRow, IvrMenuRow, RingGroupRow } from "../src/repo/pbxTypes.js";
import { setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";

const BASE = "https://api.test.mimt.ca";
const BIZ = "00000000-0000-4000-8000-0000000000b1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const created = new Date("2026-01-01T00:00:00Z");

const ext = (n: number, over: Partial<ExtensionRow> = {}): ExtensionRow => ({
  id: id(n),
  businessId: BIZ,
  number: String(100 + n),
  userId: `user-${n}`,
  displayName: `Poste ${n}`,
  voicemail: { enabled: true, greeting: null },
  forwardToMobile: null,
  did: null,
  ringTimeoutS: 20,
  createdAt: created,
  ...over,
});

const group = (over: Partial<RingGroupRow> = {}): RingGroupRow => ({
  id: id(50),
  businessId: BIZ,
  name: "Ventes",
  number: "200",
  strategy: "sequential",
  memberExtensionIds: [id(1), id(2)],
  timeoutS: 15,
  overflow: null,
  createdAt: created,
  ...over,
});

const menu = (over: Partial<IvrMenuRow> = {}): IvrMenuRow => ({
  id: id(70),
  businessId: BIZ,
  name: "Principal",
  greeting: { fr: "Pour les ventes, faites le 1.", en: "For sales, press 1." },
  greetingRecordingUrl: null,
  options: [
    { digit: "1", target: { type: "ring_group", ringGroupId: id(50) } },
    { digit: "2", target: { type: "extension", extensionId: id(1) } },
  ],
  timeoutS: 5,
  maxRetries: 1,
  timeoutTarget: { type: "voicemail" },
  invalidTarget: null,
  createdAt: created,
  ...over,
});

const hours = (over: Partial<BusinessHours> = {}): BusinessHours => ({
  businessId: BIZ,
  timezone: "America/Montreal",
  weekly: DEFAULT_WEEKLY_SCHEDULE,
  holidays: [],
  quebecHolidays: true,
  openTarget: { type: "ivr", ivrMenuId: id(70) },
  closedTarget: { type: "voicemail" },
  ...over,
});

function ctxOf(over: Partial<router.PbxSnapshot> = {}, now = new Date("2026-10-14T14:00:00Z")): router.RouteContext {
  return {
    snap: {
      business: { id: BIZ, name: "Café Test", recordingPolicy: DEFAULT_RECORDING_POLICY },
      extensions: [ext(1), ext(2)],
      ringGroups: [group()],
      ivrMenus: [menu()],
      hours: hours(),
      canRecord: false,
      transcribe: false,
      ...over,
    },
    now,
    base: BASE,
    numberId: id(900),
  };
}

const xml = (vr: { toString(): string }) => vr.toString();

describe("PBX hours (America/Montreal)", () => {
  it("is open on a weekday at 10:00 local and closed at 20:00 and on Saturday", () => {
    const h = hours();
    expect(router.isOpen(h, new Date("2026-10-14T14:00:00Z"))).toBe(true); // Wed 10:00 EDT
    expect(router.isOpen(h, new Date("2026-10-15T00:00:00Z"))).toBe(false); // Wed 20:00 EDT
    expect(router.isOpen(h, new Date("2026-10-17T14:00:00Z"))).toBe(false); // Sat
    expect(router.isOpen(h, new Date("2026-01-14T15:30:00Z"))).toBe(true); // Wed 10:30 EST (winter offset)
    expect(router.isOpen(h, new Date("2026-10-14T21:00:00Z"))).toBe(false); // 17:00 local: close is exclusive
  });

  it("closes on Quebec statutory holidays only when quebecHolidays is on", () => {
    const thanksgiving = new Date("2026-10-12T14:00:00Z"); // Monday 10:00, Action de grâces 2026
    expect(router.holidayAt(hours(), thanksgiving)).toBe("Action de grâces");
    expect(router.isOpen(hours(), thanksgiving)).toBe(false);
    expect(router.isOpen(hours({ quebecHolidays: false }), thanksgiving)).toBe(true);
    // Fête nationale (Wed June 24, 2026) and Good Friday (April 3, 2026).
    expect(router.isOpen(hours(), new Date("2026-06-24T14:00:00Z"))).toBe(false);
    expect(router.isOpen(hours(), new Date("2026-04-03T14:00:00Z"))).toBe(false);
  });

  it("computes the Quebec holiday rules (Sunday shifts, Patriotes, Easter)", () => {
    const y2027 = quebecStatutoryHolidays(2027).map((h) => h.date);
    expect(y2027).toContain("2027-03-26"); // Good Friday (Easter March 28)
    expect(y2027).toContain("2027-05-24"); // Monday before May 25
    expect(y2027).toContain("2027-06-24");
    expect(y2027).toContain("2027-10-11"); // 2nd Monday of October
    // 2029: June 24 is a Sunday → June 25; 2029 July 1 is a Sunday → July 2.
    const y2029 = quebecStatutoryHolidays(2029).map((h) => h.date);
    expect(y2029).toContain("2029-06-25");
    expect(y2029).toContain("2029-07-02");
  });

  it("honours custom closures", () => {
    const h = hours({ holidays: [{ date: "2026-10-14", name: "Inventaire" }] });
    expect(router.holidayAt(h, new Date("2026-10-14T14:00:00Z"))).toBe("Inventaire");
    expect(router.isOpen(h, new Date("2026-10-14T14:00:00Z"))).toBe(false);
  });

  it("a schedule DID goes to the open target when open and the closed target otherwise", () => {
    const schedule: RouteTarget = { type: "schedule" };
    const open = xml(router.inbound(ctxOf(), schedule));
    expect(open).toContain("<Gather");
    expect(open).toContain("ivr-input");
    const closed = xml(router.inbound(ctxOf({}, new Date("2026-10-12T14:00:00Z")), schedule));
    expect(closed).not.toContain("<Gather");
    expect(closed).toContain("<Record");
    expect(closed).toContain("Vous avez joint la boîte vocale de Café Test");
    // No hours stored: general voicemail.
    expect(xml(router.inbound(ctxOf({ hours: null }), schedule))).toContain("<Record");
  });
});

describe("PBX IVR", () => {
  const m = menu();

  it("plays the greeting French first inside a one-digit Gather", () => {
    const out = xml(router.ivrMenu(ctxOf(), m));
    expect(out).toMatch(/<Gather[^>]*numDigits="1"/);
    expect(out.indexOf('language="fr-CA"')).toBeLessThan(out.indexOf('language="en-CA"'));
  });

  it("routes a valid key to its target", () => {
    const out = xml(router.ivrInput(ctxOf(), m, "2", 0));
    expect(out).toContain("<Client>user-1</Client>");
    expect(out).toContain("k=ext");
  });

  it("replays on an invalid key, then falls back to the timeout target", () => {
    const retry = xml(router.ivrInput(ctxOf(), m, "9", 0));
    expect(retry).toContain("Ce choix n'est pas valide.");
    expect(retry).toContain("<Gather");
    expect(retry).toContain("a=1");
    const last = xml(router.ivrInput(ctxOf(), m, "9", 1));
    expect(last).not.toContain("<Gather");
    expect(last).toContain("<Record");
  });

  it("replays on no input and says goodbye when there is no timeout target", () => {
    expect(xml(router.ivrInput(ctxOf(), m, undefined, 0))).toContain("<Gather");
    const bye = xml(router.ivrInput(ctxOf(), menu({ timeoutTarget: null }), undefined, 1));
    expect(bye).toContain("Merci d'avoir appelé. Au revoir.");
    expect(bye).toContain("<Hangup/>");
  });
});

describe("PBX ring groups", () => {
  it("sequential: rings one member at a time, then overflows to the group voicemail", () => {
    const ctx = ctxOf();
    const g = group();
    const first = xml(router.dialRingGroup(ctx, g));
    expect(first).toContain("<Client>user-1</Client>");
    expect(first).not.toContain("user-2");
    const second = xml(router.dialResult(ctx, "rg", g.id, 0, "no-answer"));
    expect(second).toContain("<Client>user-2</Client>");
    const over = xml(router.dialResult(ctx, "rg", g.id, 1, "busy"));
    expect(over).toContain("<Record");
    expect(over).toContain("Ventes");
  });

  it("simultaneous: rings everyone once, then the overflow target", () => {
    const g = group({ strategy: "simultaneous", overflow: { type: "extension", extensionId: id(2) } });
    const ctx = ctxOf({ ringGroups: [g] });
    const all = xml(router.dialRingGroup(ctx, g));
    expect(all).toContain("<Client>user-1</Client>");
    expect(all).toContain("<Client>user-2</Client>");
    const over = xml(router.dialResult(ctx, "rg", g.id, 0, "no-answer"));
    expect(over).toContain("<Client>user-2</Client>");
    expect(over).toContain("k=ext");
  });

  it("an answered call ends without voicemail", () => {
    expect(xml(router.dialResult(ctxOf(), "rg", id(50), 0, "completed"))).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });

  it("an overflow loop is cut by the hop limit", () => {
    const g = group({ id: id(51), memberExtensionIds: [], overflow: { type: "ring_group", ringGroupId: id(51) } });
    const out = xml(router.route(ctxOf({ ringGroups: [g] }), { type: "ring_group", ringGroupId: g.id }));
    expect(out).toContain("Au revoir");
  });
});

describe("PBX recording consent and forwarding", () => {
  const policy = { ...DEFAULT_RECORDING_POLICY, mode: "all" as const };

  it("plays the consent prompt (French first) before anything else and records answered legs", () => {
    const ctx = ctxOf({ business: { id: BIZ, name: "Café Test", recordingPolicy: policy }, canRecord: true });
    const out = xml(router.inbound(ctx, { type: "extension", extensionId: id(1) }));
    const consentFr = out.indexOf("Cet appel peut être enregistré");
    expect(consentFr).toBeGreaterThan(-1);
    expect(consentFr).toBeLessThan(out.indexOf("This call may be recorded"));
    expect(consentFr).toBeLessThan(out.indexOf("<Dial"));
    expect(out).toContain('record="record-from-answer-dual"');
  });

  it("never records or prompts without the call_recording feature or with policy off", () => {
    const noPlan = xml(router.inbound(ctxOf({ business: { id: BIZ, name: "x", recordingPolicy: policy }, canRecord: false }), { type: "extension", extensionId: id(1) }));
    expect(noPlan).not.toContain("enregistré");
    expect(noPlan).not.toContain("record=");
    const off = xml(router.inbound(ctxOf({ canRecord: true }), { type: "extension", extensionId: id(1) }));
    expect(off).not.toContain("enregistré");
  });

  it("on_demand: prompt is played but nothing is recorded automatically", () => {
    const ctx = ctxOf({ business: { id: BIZ, name: "x", recordingPolicy: { ...policy, mode: "on_demand" } }, canRecord: true });
    const out = xml(router.inbound(ctx, { type: "extension", extensionId: id(1) }));
    expect(out).toContain("Cet appel peut être enregistré");
    expect(out).not.toContain("record=");
  });

  it("forwards only to Canada/US non-premium numbers", () => {
    expect(xml(router.route(ctxOf(), { type: "external", number: "+15145550123" }))).toContain("<Number>+15145550123</Number>");
    const premium = xml(router.route(ctxOf(), { type: "external", number: "+19005550123" }));
    expect(premium).not.toContain("<Dial");
    expect(premium).toContain("Ce transfert n'est pas permis.");
    expect(xml(router.route(ctxOf(), { type: "external", number: "+18765550123" }))).not.toContain("<Dial");
  });

  it("mobile forwarding gets the press-1 whisper so carrier voicemail never answers", () => {
    const out = xml(router.dialExtension(ctxOf(), ext(3, { userId: null, forwardToMobile: "+14385550111" })));
    expect(out).toContain("<Number");
    expect(out).toContain("whisper");
    expect(xml(router.whisperInput("1"))).not.toContain("Hangup");
    expect(xml(router.whisperInput("2"))).toContain("<Hangup/>");
  });

  it("an AI receptionist target redirects to the AI webhook", () => {
    expect(xml(router.route(ctxOf(), { type: "ai_receptionist" }))).toContain("/webhooks/twilio/ai/receptionist?b=");
  });
});

// ------------------------------------------------------------------------------------- webhooks

describe("PBX through the Twilio webhooks", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup({ now: () => new Date("2026-10-14T14:00:00Z") });
  });
  afterEach(() => ctx.app.close());

  it("a call to a business DID is routed by the PBX (open hours → IVR)", async () => {
    const { business, ext: e, didNumber } = await makeBusiness(ctx);
    const m = await ctx.repo.pbx.createIvrMenu({
      businessId: business.id,
      name: "Principal",
      greeting: { fr: "Bienvenue chez Café Test.", en: "Welcome to Café Test." },
      greetingRecordingUrl: null,
      options: [{ digit: "1", target: { type: "extension", extensionId: e.id } }],
      timeoutS: 5,
      maxRetries: 1,
      timeoutTarget: null,
      invalidTarget: null,
    });
    await ctx.repo.pbx.putHours({ ...hours(), businessId: business.id, openTarget: { type: "ivr", ivrMenuId: m.id } });
    await ctx.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "schedule" } });

    const res = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CA-biz-1", From: "+14185550199", To: didNumber.e164 });
    expect(res.body).toContain("Bienvenue chez Café Test.");
    expect(res.body).toContain("/webhooks/twilio/pbx/ivr-input");
    const call = await ctx.repo.getCallBySid("CA-biz-1");
    expect(call).toMatchObject({ direction: "inbound", telecomAccountId: business.telecomAccountId });

    // The caller presses 1: the IVR webhook (signed) rings extension 101.
    const action = /action="([^"]+)"/.exec(res.body)![1]!.replace(/&amp;/g, "&");
    const path = action.replace("https://api.test.mimt.ca", "");
    const input = await twilioPost(ctx, path, { CallSid: "CA-biz-1", Digits: "1" });
    expect(input.body).toContain(`<Client>${e.userId}</Client>`);
    // Unsigned PBX webhooks are refused.
    const forged = await twilioPost(ctx, path, { CallSid: "CA-biz-1", Digits: "1" }, "bad-signature");
    expect(forged.statusCode).toBe(403);
  });

  it("a call to a business DID on a holiday goes to the closed target", async () => {
    await ctx.app.close();
    ctx = await setup({ now: () => new Date("2026-10-12T14:00:00Z") });
    const { business, didNumber } = await makeBusiness(ctx);
    await ctx.repo.pbx.putHours({ ...hours(), businessId: business.id, openTarget: { type: "directory" } });
    await ctx.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "schedule" } });
    const res = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CA-biz-2", From: "+14185550199", To: didNumber.e164 });
    expect(res.body).toContain("<Record");
    expect(res.body).not.toContain("directory-input");
  });

  it("a member dials an extension from the app: free internal call", async () => {
    const { staff, owner } = await makeBusiness(ctx);
    const res = await twilioPost(ctx, "/webhooks/twilio/voice/outbound", { CallSid: "CA-int-1", From: `client:${owner.user.id}`, To: "101" });
    expect(res.body).toContain(`<Client>${staff.user.id}</Client>`);
    expect(await ctx.repo.getCallBySid("CA-int-1")).toMatchObject({ kind: "app", toNumber: "ext:101" });
  });

  it("9-1-1 from a business extension goes straight to 9-1-1, even with the business suspended", async () => {
    const { staff, business } = await makeBusiness(ctx);
    await ctx.repo.updateAccount(business.telecomAccountId, { status: "SUSPENDED" });
    for (const dialed of ["911", "9-1-1", "+1911"]) {
      const res = await twilioPost(ctx, "/webhooks/twilio/voice/outbound", { CallSid: `CA-e-${dialed}`, From: `client:${staff.user.id}`, To: dialed });
      expect(res.body).toContain("<Number>911</Number>");
      expect(res.body).not.toContain("<Say");
      expect(res.body).not.toContain("<Client>");
    }
  });

  it("an extension can never be 911 or another N11 code", () => {
    for (const n of ["911", "933", "9911", "411", "011"]) expect(isValidExtension(n)).toBe(false);
    expect(isValidExtension("101")).toBe(true);
  });
});
