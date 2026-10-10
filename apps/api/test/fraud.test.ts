import { describe, expect, it } from "vitest";
import { checkSmsCaps, checkVoiceCaps, effectiveCaps, exceedsDailySpend } from "../src/fraud/caps.js";
import { checkVoiceDestination } from "../src/fraud/destinations.js";
import { looksLikeOtp } from "../src/fraud/policy.js";
import { InMemoryRateLimiter } from "../src/fraud/rateLimiter.js";
import { classifyDestination, normalizeDialed, smsSegments } from "../src/lib/phone.js";
import type { Usage } from "../src/repo/types.js";

const now = new Date("2026-10-09T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const usage = (u: Partial<Usage> = {}): Usage => ({
  telecomAccountId: "a", period: "2026-10", minutesOut: 0, minutesIn: 0, smsOut: 0, bonusMinutesOut: 0, spendCad: 0, intlSpendCad: 0, ...u,
});

describe("caps", () => {
  it("halves outbound caps during the first 14 days", () => {
    expect(effectiveCaps("free", "standard", daysAgo(3), now)).toMatchObject({ outboundMinutes: 15, outboundSms: 25 });
    expect(effectiveCaps("free", "standard", daysAgo(15), now)).toMatchObject({ outboundMinutes: 30, outboundSms: 50 });
    expect(effectiveCaps("premium", "new", daysAgo(60), now)).toMatchObject({ outboundMinutes: 250 });
    expect(effectiveCaps("premium", "trusted", daysAgo(1), now)).toMatchObject({ outboundMinutes: 500 });
  });

  it("checks minutes, bonus minutes and concurrency", () => {
    const caps = effectiveCaps("free", "standard", daysAgo(60), now);
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 10 }), activeCalls: 0 })).toEqual({ ok: true, remaining: 20 });
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 30 }), activeCalls: 0 })).toMatchObject({ ok: false, reason: "minutes_exhausted" });
    expect(checkVoiceCaps({ caps, usage: usage({ minutesOut: 30, bonusMinutesOut: 250 }), activeCalls: 0 })).toEqual({ ok: true, remaining: 250 });
    expect(checkVoiceCaps({ caps, usage: usage(), activeCalls: 1 })).toMatchObject({ ok: false, reason: "too_many_calls" });
    expect(checkSmsCaps({ caps, usage: usage({ smsOut: 49 }), segments: 2 })).toMatchObject({ ok: false });
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
