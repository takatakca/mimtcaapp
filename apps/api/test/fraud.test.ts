import { describe, expect, it } from "vitest";
import { checkOnNetCaps, checkSmsCaps, checkVoiceCaps, effectiveCaps, exceedsDailySpend } from "../src/fraud/caps.js";
import { checkVoiceDestination } from "../src/fraud/destinations.js";
import { looksLikeOtp } from "../src/fraud/policy.js";
import { InMemoryRateLimiter } from "../src/fraud/rateLimiter.js";
import { classifyDestination, normalizeDialed, smsSegments } from "../src/lib/phone.js";
import { emptyUsage, type Usage } from "../src/repo/types.js";

const now = new Date("2026-10-09T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const usage = (u: Partial<Usage> = {}): Usage => ({ ...emptyUsage("a", "2026-10"), ...u });

describe("caps", () => {
  it("halves outbound caps during the first 14 days", () => {
    expect(effectiveCaps("lock", "standard", daysAgo(3), now)).toMatchObject({ outboundMinutes: 30, messages: 75 });
    expect(effectiveCaps("lock", "standard", daysAgo(15), now)).toMatchObject({ outboundMinutes: 60, messages: 150 });
    expect(effectiveCaps("premium", "new", daysAgo(60), now)).toMatchObject({ outboundMinutes: 100, mms: 25 });
    expect(effectiveCaps("premium", "trusted", daysAgo(1), now)).toMatchObject({ outboundMinutes: 200 });
  });

  it("the free plan has no phone-network minutes or texts, only app-to-app minutes", () => {
    const caps = effectiveCaps("free", "standard", daysAgo(60), now);
    expect(checkVoiceCaps({ caps, usage: usage(), activeCalls: 0 })).toMatchObject({ ok: false, reason: "minutes_exhausted" });
    expect(checkSmsCaps({ caps, usage: usage(), segments: 1 })).toMatchObject({ ok: false, reason: "sms_exhausted" });
    expect(checkOnNetCaps({ caps, usage: usage({ minutesOnNet: 100 }) })).toEqual({ ok: true, remaining: 20 });
    expect(checkOnNetCaps({ caps, usage: usage({ minutesOnNet: 120 }) })).toMatchObject({ ok: false, reason: "on_net_minutes_exhausted" });
  });

  it("paid app-to-app minutes draw from outbound minutes", () => {
    const caps = effectiveCaps("lock", "standard", daysAgo(60), now);
    expect(checkOnNetCaps({ caps, usage: usage({ minutesOut: 50 }) })).toEqual({ ok: true, remaining: 10 });
    expect(checkOnNetCaps({ caps, usage: usage({ minutesOut: 60, minutesOnNet: 0 }) })).toMatchObject({ ok: false });
  });

  it("checks minutes, bonus minutes and concurrency", () => {
    const caps = effectiveCaps("lock", "standard", daysAgo(60), now);
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 10 }), activeCalls: 0 })).toEqual({ ok: true, remaining: 50 });
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 60 }), activeCalls: 0 })).toMatchObject({ ok: false, reason: "minutes_exhausted" });
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 60, bonusMinutesOut: 250 }), activeCalls: 0 })).toEqual({ ok: true, remaining: 250 });
    expect(checkVoiceCaps({ caps, usage: usage(), activeCalls: 1 })).toMatchObject({ ok: false, reason: "too_many_calls" });
  });

  it("counts texts sent AND received against the messages cap, and MMS against their own cap", () => {
    const caps = effectiveCaps("premium", "trusted", daysAgo(60), now);
    expect(checkSmsCaps({ caps, usage: usage({ smsOut: 200, smsIn: 199 }), segments: 1 })).toEqual({ ok: true, remaining: 0 });
    expect(checkSmsCaps({ caps, usage: usage({ smsOut: 200, smsIn: 199 }), segments: 2 })).toMatchObject({ ok: false, reason: "sms_exhausted" });
    expect(checkSmsCaps({ caps, usage: usage({ mmsOut: 50 }), segments: 1, mms: true })).toMatchObject({ ok: false, reason: "mms_exhausted" });
    expect(checkSmsCaps({ caps, usage: usage({ mmsOut: 50 }), segments: 1 })).toMatchObject({ ok: true });
  });

  it("the trial gets 20 minutes and 20 texts whatever the plan", () => {
    expect(effectiveCaps("lock", "trusted", daysAgo(60), now, true)).toMatchObject({ outboundMinutes: 20, inboundMinutes: 20, messages: 20, mms: 0 });
  });

  it("flags daily spend above the threshold", () => {
    expect(exceedsDailySpend(25, 25)).toBe(false);
    expect(exceedsDailySpend(25.01, 25)).toBe(true);
  });
});

describe("destinations", () => {
  it("classifies NANP and international numbers", () => {
    expect(classifyDestination("+15145550123")).toBe("ca");
    expect(classifyDestination("+12125550123")).toBe("us");
    expect(classifyDestination("+19005550123")).toBe("nanp_premium");
    expect(classifyDestination("+14169765555")).toBe("nanp_premium");
    expect(classifyDestination("+18765550123")).toBe("nanp_high_cost");
    expect(classifyDestination("+5355550100")).toBe("cuba");
    expect(classifyDestination("+442071234567")).toBe("intl");
    expect(classifyDestination("+1123")).toBe("invalid");
  });

  it("blocks premium always and international without entitlement and credit", () => {
    const none = { entitled: false, creditCents: 0 };
    const paid = { entitled: true, creditCents: 500 };
    expect(checkVoiceDestination("+14165550123", none).ok).toBe(true);
    expect(checkVoiceDestination("+19005550123", paid)).toMatchObject({ ok: false, reason: "premium_rate_blocked" });
    expect(checkVoiceDestination("+442071234567", none)).toMatchObject({ ok: false, reason: "intl_not_allowed" });
    expect(checkVoiceDestination("+442071234567", { entitled: true, creditCents: 0 })).toMatchObject({ ok: false, reason: "intl_no_credit" });
    expect(checkVoiceDestination("+18765550123", paid).ok).toBe(true);
  });

  it("normalizes dialed strings", () => {
    expect(normalizeDialed("(514) 555-0123")).toBe("+15145550123");
    expect(normalizeDialed("1 514 555 0123")).toBe("+15145550123");
    expect(normalizeDialed("011 44 20 7123 4567")).toBe("+442071234567");
    expect(normalizeDialed("411")).toBeNull();
  });
});

describe("rate limiter", () => {
  it("is a token bucket that refills over time", async () => {
    let t = 0;
    const rl = new InMemoryRateLimiter(() => t);
    const rule = { capacity: 2, windowSeconds: 60 };
    expect(await rl.take("k", rule)).toBe(true);
    expect(await rl.take("k", rule)).toBe(true);
    expect(await rl.take("k", rule)).toBe(false);
    expect(await rl.take("other", rule)).toBe(true);
    t += 30_000;
    expect(await rl.take("k", rule)).toBe(true);
    expect(await rl.take("k", rule)).toBe(false);
  });
});

describe("content", () => {
  it("detects OTP-shaped texts and counts segments", () => {
    expect(looksLikeOtp("Votre code de vérification: 123456")).toBe(true);
    expect(looksLikeOtp("On se voit à 1930 ce soir?")).toBe(false);
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("😀".repeat(70))).toBe(1);
    expect(smsSegments("😀".repeat(71))).toBe(2);
  });
});
