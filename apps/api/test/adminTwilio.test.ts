// Admin import of an existing Twilio number + read-only diagnostics (routes/adminTwilio.ts), and the lifecycle guard
// that never deletes at Twilio a number Twilio created before NUMBER_LIFECYCLE_FROM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runNumberLifecycle } from "../src/jobs/numberLifecycle.js";
import type { TwilioIncomingNumber } from "../src/gateways/twilio.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { fakeTwilio, LEGACY_FREE, makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

const E164 = "+15799996789";
const OLD = new Date("2025-03-01T12:00:00Z");
const BASE = "https://api.test.mimt.ca";

function twilioWith(numbers: TwilioIncomingNumber[]) {
  return {
    ...fakeTwilio(),
    findIncomingNumber: vi.fn(async (e164: string) => numbers.find((n) => n.e164 === e164) ?? null),
    diagnostics: vi.fn(async () => ({
      accountSidEnd: "1234",
      accountName: "MIMT",
      accountStatus: "active",
      accountType: "Full",
      balance: { amount: "42.00", currency: "USD" },
      twimlApp: { configured: true, voiceUrl: `${BASE}/webhooks/twilio/voice/outbound` },
      voiceCountries: ["CA", "US"],
      usageTriggers: [],
      numbers: [],
    })),
  };
}

const line: TwilioIncomingNumber = {
  sid: "PNowner",
  e164: E164,
  dateCreated: OLD,
  voiceUrl: `${BASE}/webhooks/twilio/voice/inbound`,
  smsUrl: "https://demo.twilio.com/welcome/sms/reply",
  statusCallback: `${BASE}/webhooks/twilio/voice/status`,
  voiceApplicationSid: null,
};

let ctx: Ctx;
let clock: Date;
beforeEach(async () => {
  clock = new Date();
  ctx = await setup({ twilio: twilioWith([line]), now: () => clock, config: { ...LEGACY_FREE } });
});
afterEach(async () => {
  await ctx.app.close();
});

async function staff() {
  const s = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(s.user.id);
  return s;
}
const importNumber = (auth: Record<string, string>, body: object) => ctx.app.inject({ method: "POST", url: "/v1/admin/numbers/import", headers: auth, payload: body });

describe("admin Twilio routes", () => {
  it("are for MIMT staff only", async () => {
    const someone = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/twilio/diagnostics", headers: someone.auth })).statusCode).toBe(403);
    expect((await importNumber(someone.auth, { e164: E164 })).statusCode).toBe(403);
  });

  it("diagnostics report the account and what our webhooks expect, without the full SID", async () => {
    const s = await staff();
    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/twilio/diagnostics", headers: s.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountSidEnd: "1234", voiceCountries: ["CA", "US"], expected: { voiceUrl: `${BASE}/webhooks/twilio/voice/inbound` } });
  });

  it("imports a number of the API's Twilio account into the admin's account, keeps Twilio's date and changes nothing at Twilio", async () => {
    const s = await staff();
    const res = await importNumber(s.auth, { e164: E164 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ e164: E164, state: "active", telecomAccountId: s.account.id, warnings: ["sms_url_differs"] });
    const n = await ctx.repo.getNumberByE164(E164);
    expect(n?.createdAt.toISOString()).toBe(OLD.toISOString());
    expect(n?.twilioSid).toBe("PNowner");
    expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();
    expect(ctx.twilio!.releaseNumber).not.toHaveBeenCalled();

    // A call to the line now rings the owner's apps.
    const call = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAt1", From: "+14165550123", To: E164 });
    expect(call.body).toContain(`<Client>${s.user.id}</Client>`);

    expect((await importNumber(s.auth, { e164: E164 })).json().error).toBe("number_exists");
  });

  it("refuses a number that lives in another Twilio account (its webhooks would fail our signature check)", async () => {
    const s = await staff();
    const res = await importNumber(s.auth, { e164: "+15797002135" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("not_in_mimt_twilio_account");
    expect(await ctx.repo.getNumberByE164("+15797002135")).toBeNull();
  });

  it("needs a recent authentication", async () => {
    const s = await staff();
    clock = new Date(clock.getTime() + 11 * 60_000);
    const res = await importNumber(s.auth, { e164: E164 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("step_up_required");
  });
});

describe("lifecycle guard on Twilio's own creation date", () => {
  it("never deletes at Twilio a number Twilio created before the cut-off, even if our row is newer", async () => {
    const repo = new MemoryRepository();
    const t0 = new Date("2026-11-01T00:00:00Z");
    const user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: null });
    const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
    await repo.createNumber({ e164: E164, twilioSid: "PNold", telecomAccountId: account.id, kind: "local", state: "quarantine", lastActivityAt: t0, stateChangedAt: t0, quarantineUntil: t0 });
    const twilio = { ...fakeTwilio(), fetchNumberConfig: vi.fn(async () => ({ e164: E164, dateCreated: OLD, voiceFallbackUrl: null, smsFallbackUrl: null })) };
    const notifier = { notify: vi.fn(async () => {}) };
    await runNumberLifecycle({ repo, twilio, notifier, now: new Date("2027-06-01T00:00:00Z"), since: new Date("2026-10-23T00:00:00Z") });
    expect(twilio.releaseNumber).not.toHaveBeenCalled();
    expect((await repo.getNumberByE164(E164))?.state).toBe("quarantine");
  });
});
