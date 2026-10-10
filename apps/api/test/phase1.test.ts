import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAdmobSignature } from "../src/ads/ssv.js";
import { purchaseFromApplePayload } from "../src/billing/iap.js";
import { quebecTaxLines } from "../src/billing/taxes.js";
import { playIntegrityOk } from "../src/devices/verify.js";
import { cubaSipUri } from "../src/lib/cuba.js";
import { assertMediaPath } from "../src/gateways/media.js";
import { isSpendAnomaly, parseSentryDsn } from "../src/monitoring/report.js";
import { applyTwilioGuardrails } from "../src/jobs/twilioGuardrails.js";
import { dailyTriggerUsd, voiceCountryPermission } from "../src/twilio/guardrails.js";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

describe("invoice taxes", () => {
  it("adds GST, QST and the monthly 9-1-1 tax on a subscription", () => {
    const lines = quebecTaxLines({ baseUnitCents: 1999, quantity: 1, recurring: "month", chargeE911: true, locale: "fr-CA" });
    expect(lines.map((l) => l.unitAmountCents)).toEqual([100, 199, 55]);
  });

  it("skips the 9-1-1 tax on a one-time credit", () => {
    const lines = quebecTaxLines({ baseUnitCents: 500, quantity: 1, recurring: null, chargeE911: false, locale: "en-CA" });
    expect(lines.map((l) => l.name)).toEqual(["GST (5%)", "QST (9.975%)"]);
  });
});

describe("cuba trunk", () => {
  it("builds a SIP URI with a hostname only", () => {
    expect(cubaSipUri("+5355550100", "sip.example.net")).toBe("sip:5355550100@sip.example.net");
    expect(cubaSipUri("+15145550100", "sip.example.net")).toBeNull();
    expect(cubaSipUri("+5355550100", "user:secret@sip.example.net")).toBeNull();
  });
});

describe("monitoring", () => {
  it("parses a Sentry DSN and flags spend anomalies", () => {
    expect(parseSentryDsn("https://public@o1.ingest.sentry.io/123")?.storeUrl).toBe("https://o1.ingest.sentry.io/api/123/envelope/");
    expect(parseSentryDsn("http://public@o1.ingest.sentry.io/123")).toBeNull();
    expect(isSpendAnomaly(31, 10)).toBe(true);
    expect(isSpendAnomaly(20, 10)).toBe(false);
  });
});

describe("twilio guardrails", () => {
  it("keeps only Canada and the US, with high-risk ranges off", () => {
    expect(voiceCountryPermission("CA").low_risk_numbers_enabled).toBe(true);
    expect(voiceCountryPermission("US").high_risk_tollfraud_numbers_enabled).toBe(false);
    expect(voiceCountryPermission("CU").low_risk_numbers_enabled).toBe(false);
    expect(dailyTriggerUsd(25, 1.4)).toBe("17.86");
  });

  it("updates geo permissions and creates the daily trigger without putting secrets in the URL", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: href, method, body: typeof init?.body === "string" ? init.body : undefined });
      expect(href).not.toContain("secret-value");
      if (href.includes("/DialingPermissions/Countries")) {
        return Response.json({ content: [{ iso_code: "CA" }, { iso_code: "US" }, { iso_code: "CU" }], meta: {} });
      }
      if (href.includes("BulkCountryUpdates") || href.includes("SmsPumpingProtection") || href.includes("Usage/Triggers")) {
        if (method === "GET") return Response.json({ usage_triggers: [] });
        return new Response("ok", { status: href.includes("SmsPumping") ? 404 : 201 });
      }
      return new Response("no", { status: 500 });
    }) as typeof fetch;

    const result = await applyTwilioGuardrails({
      accountSid: "ACtest",
      apiKeySid: "SKtest",
      apiKeySecret: "secret-value",
      callbackUrl: "https://api.mimt.ca/webhooks/twilio/usage",
      alertCad: 25,
      usdToCad: 1.4,
      fetchImpl,
    });
    expect(result).toMatchObject({ countries: 3, trigger: "created", pumping: "unsupported" });
    const update = calls.find((c) => c.url.includes("BulkCountryUpdates"))!.body!;
    expect(decodeURIComponent(update)).toContain('"iso_code":"CA"');
    expect(decodeURIComponent(update)).toContain('"low_risk_numbers_enabled":false');
  });
});

describe("store purchases", () => {
  it("maps a signed Apple payload onto a MIMT plan", () => {
    const now = new Date("2026-10-09T00:00:00Z");
    const purchase = purchaseFromApplePayload(
      { productId: "ca.mimt.app.premium.monthly", bundleId: "ca.mimt.app", originalTransactionId: "100", expiresDate: now.getTime() + 86_400_000 },
      now,
      "ca.mimt.app",
    );
    expect(purchase).toMatchObject({ plan: "premium", status: "active", transactionId: "100" });
    expect(purchaseFromApplePayload({ productId: "other", originalTransactionId: "1" }, now, "ca.mimt.app")).toBeNull();
  });

  it("accepts a Play Integrity payload only when the nonce and verdicts match", () => {
    const ok = {
      tokenPayloadExternal: {
        requestDetails: { nonce: "abc" },
        appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
        deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
      },
    };
    expect(playIntegrityOk(ok, "abc")).toBe(true);
    expect(playIntegrityOk(ok, "other")).toBe(false);
  });
});

describe("private media paths", () => {
  it("rejects traversal", () => {
    expect(assertMediaPath("account/RE123.mp3")).toBe("account/RE123.mp3");
    expect(() => assertMediaPath("../secret")).toThrow(/invalid media path/);
  });
});

describe("device attestation and ad rewards", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(() => ctx.app.close());

  it("binds one device to one user with the development assertion", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const challenge = await ctx.app.inject({ method: "POST", url: "/v1/devices/challenge", headers: a.auth });
    const { challenge: nonce, challengeToken } = challenge.json();
    const ok = await ctx.app.inject({
      method: "POST",
      url: "/v1/devices/attest",
      headers: a.auth,
      payload: { platform: "ios", deviceKey: "device-key-1", challenge: nonce, challengeToken, assertion: `dev:${nonce}` },
    });
    expect(ok.statusCode).toBe(200);
    expect((await ctx.repo.getUser(a.user.id))!.deviceVerifiedAt).toBeInstanceOf(Date);

    const other = await ctx.app.inject({ method: "POST", url: "/v1/devices/challenge", headers: b.auth });
    const second = other.json();
    const taken = await ctx.app.inject({
      method: "POST",
      url: "/v1/devices/attest",
      headers: b.auth,
      payload: { platform: "ios", deviceKey: "device-key-1", challenge: second.challenge, challengeToken: second.challengeToken, assertion: `dev:${second.challenge}` },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe("device_already_used");
  });

  it("credits bonus minutes only from a signed AdMob callback", async () => {
    const u = await makeUser(ctx);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    ctx.deps.admobKeys = async () => new Map([["7", pem]]);
    const message = `custom_data=${u.user.id}&transaction_id=tx-12345678&user_id=${u.user.id}`;
    const signer = createSign("SHA256");
    signer.update(message);
    signer.end();
    const signature = signer.sign(privateKey).toString("base64url");
    expect(verifyAdmobSignature(message, signature, pem)).toBe(true);

    const query = `${message}&signature=${encodeURIComponent(signature)}&key_id=7`;
    expect((await ctx.app.inject({ method: "GET", url: `/webhooks/admob/ssv?${query}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "GET", url: `/webhooks/admob/ssv?${query}` })).statusCode).toBe(204);
    const claim = await ctx.app.inject({
      method: "POST",
      url: "/v1/rewards/claim",
      headers: u.auth,
      payload: { kind: "rewarded_ad_10min", adUnitId: "test" },
    });
    expect(claim.json()).toEqual({ creditedMinutes: 10 });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOut).toBe(10);
    const again = await ctx.app.inject({
      method: "POST",
      url: "/v1/rewards/claim",
      headers: u.auth,
      payload: { kind: "rewarded_ad_10min", adUnitId: "test" },
    });
    expect(again.statusCode).toBe(409);
  });
});
