// Call reliability (docs/MIMT-CALL-RELIABILITY.md): Twilio fallback URLs on new numbers, the start-up backfill that
// never touches numbers created before 2026-10-23, and the connection-test (preflight) leg of the outbound webhook.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_BACKFILL_FROM, runFallbackBackfill } from "../src/jobs/numberFallback.js";
import { fallbackParams, numberFallbacks, type TwilioNumberConfig } from "../src/gateways/twilio.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { fakeTwilio, LEGACY_FREE, makeUser, setup, testConfig, twilioPost, type Ctx } from "./helpers.js";

const VOICE_FB = "https://mimt-fallback-1234.twil.io/voice";
const SMS_FB = "https://mimt-fallback-1234.twil.io/sms";

describe("fallback configuration", () => {
  it("accepts https URLs only and maps them to POST fallbacks", () => {
    expect(() => testConfig({ TWILIO_VOICE_FALLBACK_URL: "http://example.com/x" })).toThrow(/TWILIO_VOICE_FALLBACK_URL/);
    const config = testConfig({ TWILIO_VOICE_FALLBACK_URL: VOICE_FB });
    expect(numberFallbacks(config)).toEqual({ voiceFallbackUrl: VOICE_FB });
    expect(numberFallbacks(testConfig())).toEqual({});
    expect(fallbackParams({ voiceFallbackUrl: VOICE_FB, smsFallbackUrl: SMS_FB })).toEqual({
      voiceFallbackUrl: VOICE_FB,
      voiceFallbackMethod: "POST",
      smsFallbackUrl: SMS_FB,
      smsFallbackMethod: "POST",
    });
  });
});

describe("number purchase with fallbacks", () => {
  let ctx: Ctx;
  afterEach(() => ctx.app.close());

  it("passes the voice and SMS fallback URLs to Twilio when they are set", async () => {
    ctx = await setup({ config: { ...LEGACY_FREE, TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: SMS_FB } });
    const u = await makeUser(ctx, { e911: true, ack: true });
    const res = await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    expect(res.statusCode).toBe(201);
    expect(ctx.twilio!.purchaseNumber).toHaveBeenCalledWith(expect.objectContaining({ voiceFallbackUrl: VOICE_FB, smsFallbackUrl: SMS_FB }));
  });

  it("sends no fallback field when none is configured", async () => {
    ctx = await setup({ config: { ...LEGACY_FREE } });
    const u = await makeUser(ctx, { e911: true, ack: true });
    await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    const arg = vi.mocked(ctx.twilio!.purchaseNumber).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("voiceFallbackUrl");
    expect(arg).not.toHaveProperty("smsFallbackUrl");
  });
});

describe("fallback backfill (owner rule: never before 2026-10-23)", () => {
  const before = new Date("2026-10-01T00:00:00Z");
  const after = new Date("2026-10-25T00:00:00Z");

  async function world() {
    const repo = new MemoryRepository();
    const twilioState = new Map<string, TwilioNumberConfig>();
    const add = async (e164: string, sid: string | null, opts: { rowCreated: Date; twilioCreated: Date | null; state?: "active" | "released"; twilioE164?: string }) => {
      const n = await repo.createNumber({ e164, twilioSid: sid, telecomAccountId: null, kind: "local", state: opts.state ?? "active", lastActivityAt: after, stateChangedAt: after });
      repo.numbers.get(n.id)!.createdAt = opts.rowCreated;
      if (sid) twilioState.set(sid, { e164: opts.twilioE164 ?? e164, dateCreated: opts.twilioCreated, voiceFallbackUrl: null, smsFallbackUrl: null });
      return n;
    };
    const twilio = {
      ...fakeTwilio(),
      fetchNumberConfig: vi.fn(async (sid: string) => {
        const c = twilioState.get(sid);
        if (!c) throw new Error("not found");
        return { ...c };
      }),
      updateNumberFallbacks: vi.fn(async (sid: string, f: { voiceFallbackUrl?: string; smsFallbackUrl?: string }) => {
        const c = twilioState.get(sid)!;
        if (f.voiceFallbackUrl) c.voiceFallbackUrl = f.voiceFallbackUrl;
        if (f.smsFallbackUrl) c.smsFallbackUrl = f.smsFallbackUrl;
      }),
    };
    return { repo, twilio, add };
  }

  it("uses the 2026-10-23 cut-off", () => {
    expect(FALLBACK_BACKFILL_FROM.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("only updates MIMT numbers created after the cut-off, both in our table and at Twilio, and is idempotent", async () => {
    const w = await world();
    await w.add("+15145550101", "PNnew", { rowCreated: after, twilioCreated: after });
    await w.add("+15145550102", "PNoldrow", { rowCreated: before, twilioCreated: after });
    await w.add("+15145550103", "PNoldtwilio", { rowCreated: after, twilioCreated: before });
    await w.add("+15145550104", "PNnodate", { rowCreated: after, twilioCreated: null });
    await w.add("+15145550105", "PNmismatch", { rowCreated: after, twilioCreated: after, twilioE164: "+15145559999" });
    await w.add("+15145550106", null, { rowCreated: after, twilioCreated: after });
    await w.add("+15145550107", "PNreleased", { rowCreated: after, twilioCreated: after, state: "released" });
    const config = { TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: undefined };

    const first = await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config });
    expect(first).toEqual({ updated: 1, unchanged: 0, skipped: 5, errors: 0 });
    expect(w.twilio.updateNumberFallbacks).toHaveBeenCalledTimes(1);
    expect(w.twilio.updateNumberFallbacks).toHaveBeenCalledWith("PNnew", { voiceFallbackUrl: VOICE_FB });
    // A number created before the cut-off in our table is not even read at Twilio.
    expect(w.twilio.fetchNumberConfig).not.toHaveBeenCalledWith("PNoldrow");
    expect(w.twilio.fetchNumberConfig).not.toHaveBeenCalledWith("PNreleased");

    const second = await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config });
    expect(second).toEqual({ updated: 0, unchanged: 1, skipped: 5, errors: 0 });
    expect(w.twilio.updateNumberFallbacks).toHaveBeenCalledTimes(1);
  });

  it("adds a newly configured SMS fallback without rewriting the voice one", async () => {
    const w = await world();
    await w.add("+15145550101", "PNnew", { rowCreated: after, twilioCreated: after });
    await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config: { TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: undefined } });
    await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config: { TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: SMS_FB } });
    expect(w.twilio.updateNumberFallbacks).toHaveBeenLastCalledWith("PNnew", { smsFallbackUrl: SMS_FB });
  });

  it("does nothing without a configured fallback or without Twilio, and counts Twilio errors", async () => {
    const w = await world();
    await w.add("+15145550101", "PNnew", { rowCreated: after, twilioCreated: after });
    await w.add("+15145550108", "PNgone", { rowCreated: after, twilioCreated: after });
    expect(await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config: { TWILIO_VOICE_FALLBACK_URL: undefined, TWILIO_SMS_FALLBACK_URL: undefined } })).toEqual({ updated: 0, unchanged: 0, skipped: 0, errors: 0 });
    expect(w.twilio.fetchNumberConfig).not.toHaveBeenCalled();
    expect(await runFallbackBackfill({ repo: w.repo, twilio: null, config: { TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: undefined } })).toMatchObject({ updated: 0 });

    w.twilio.fetchNumberConfig.mockImplementation(async (sid: string) => {
      if (sid === "PNgone") throw new Error("Twilio 404");
      return { e164: "+15145550101", dateCreated: after, voiceFallbackUrl: null, smsFallbackUrl: null };
    });
    const res = await runFallbackBackfill({ repo: w.repo, twilio: w.twilio, config: { TWILIO_VOICE_FALLBACK_URL: VOICE_FB, TWILIO_SMS_FALLBACK_URL: undefined } });
    expect(res).toEqual({ updated: 1, unchanged: 0, skipped: 0, errors: 1 });
  });
});

describe("connection test leg (Twilio preflight, no To)", () => {
  let ctx: Ctx;
  afterEach(() => ctx.app.close());
  const OUT = "/webhooks/twilio/voice/outbound";

  it("keeps the line open briefly for a signed-in user, dials nothing, and is rate limited", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const res = await twilioPost(ctx, OUT, { CallSid: "CApre1", From: `client:${u.user.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Say language="fr-CA">Test de connexion MIMT.</Say>');
    expect(res.body).toContain('<Pause length="12"/>');
    expect(res.body).toContain("<Hangup/>");
    expect(res.body).not.toContain("<Dial");
    expect(ctx.repo.calls.size).toBe(0);

    for (let i = 0; i < 9; i++) await twilioPost(ctx, OUT, { CallSid: `CApre${i + 2}`, From: `client:${u.user.id}`, To: "" });
    const limited = await twilioPost(ctx, OUT, { CallSid: "CApre99", From: `client:${u.user.id}` });
    expect(limited.body).not.toContain("<Pause");
    expect(limited.body).toContain("Trop d'appels");
  });

  it("refuses an unknown identity", async () => {
    ctx = await setup();
    const res = await twilioPost(ctx, OUT, { CallSid: "CApre0", From: "client:nobody" });
    expect(res.body).not.toContain("<Pause");
    expect(res.body).toContain("Veuillez vous reconnecter");
  });
});
