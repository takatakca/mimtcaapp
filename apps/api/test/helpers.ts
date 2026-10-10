import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";
import { vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadSigningKey, SessionService } from "../src/auth/sessions.js";
import { TakatakOidc } from "../src/auth/takatak.js";
import { loadConfig } from "../src/config.js";
import type { AppDeps } from "../src/deps.js";
import type { ProvisioningProvider } from "../src/catalog/providers/types.js";
import { InMemoryRateLimiter } from "../src/fraud/rateLimiter.js";
import { createDeviceVerifier } from "../src/devices/verify.js";
import { expectedTwilioSignature, type TwilioGateway } from "../src/gateways/twilio.js";
import { MessageCipher } from "../src/lib/crypto.js";
import { MemoryRepository } from "../src/repo/memory.js";
import type { Notifier } from "../src/services/notifier.js";

export const BASE_URL = "https://api.test.mimt.ca";
export const AUTH_TOKEN = "test-twilio-auth-token";
export const NOTICE = "test-notice-1";
export const ISSUER = "https://takatak.test";
export const API_KEY = "test-takatak-api-key";

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PUBLIC_BASE_URL: BASE_URL,
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    TWILIO_TWIML_APP_SID: "APtest",
    TAKATAK_ISSUER: ISSUER,
    TAKATAK_CLIENT_ID: "mimt",
    MIMT_API_KEY: API_KEY,
    E911_NOTICE_VERSION: NOTICE,
    DAILY_SPEND_ALERT_CAD: "25",
    ...extra,
  });
}

export function fakeTwilio() {
  let n = 0;
  return {
    createVoiceToken: vi.fn((identity: string) => ({ token: `tok-${identity}`, expiresAt: new Date(Date.now() + 3600_000) })),
    searchLocalNumbers: vi.fn(async () => [{ e164: "+15145550199", locality: "Montréal", region: "QC" }]),
    purchaseNumber: vi.fn(async () => ({ sid: `PN${++n}` })),
    releaseNumber: vi.fn(async () => {}),
    createEmergencyAddress: vi.fn(async () => ({ sid: "ADtest", validated: true })),
    attachEmergencyAddress: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ sid: `SM${++n}`, status: "queued", segments: 1 })),
    startVerification: vi.fn(async () => {}),
    checkVerification: vi.fn(async () => true),
    fetchRecording: vi.fn(async () => ({ contentType: "audio/mpeg", body: Buffer.from("ID3-fake-mp3-audio") })),
    deleteRecording: vi.fn(async () => {}),
  } satisfies TwilioGateway;
}

export async function takatakKeys() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "tk-1", alg: "ES256", use: "sig" };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

export async function setup(
  opts: { config?: Record<string, string>; twilio?: TwilioGateway | null; now?: () => Date; provisioning?: ProvisioningProvider | null } = {},
) {
  const config = testConfig(opts.config);
  const repo = new MemoryRepository();
  const keys = await takatakKeys();
  const twilio = opts.twilio === undefined ? fakeTwilio() : opts.twilio;
  const notifier: Notifier & { sent: unknown[] } = { sent: [], notify: async (...args) => void notifier.sent.push(args) };
  const deps: AppDeps = {
    config,
    repo,
    sessions: new SessionService(repo, loadSigningKey(undefined).key, config.PUBLIC_BASE_URL),
    takatak: new TakatakOidc(config, repo, { jwks: keys.jwks }),
    twilio,
    billing: null,
    media: null,
    deviceVerifier: createDeviceVerifier(config),
    admobKeys: async () => new Map(),
    cipher: new MessageCipher(MessageCipher.generateKey()),
    rateLimiter: new InMemoryRateLimiter(),
    notifier,
    now: opts.now ?? (() => new Date()),
    ...(opts.provisioning === undefined ? {} : { provisioning: opts.provisioning }),
  };
  const app = await buildApp(deps);
  return { app, deps, repo, keys, twilio, notifier };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

/** Creates a user + account (+ optional e911 address/ack, number) and returns a bearer token. */
export async function makeUser(
  ctx: Ctx,
  opts: { e911?: boolean; ack?: boolean; number?: string; verified?: boolean; globalUserId?: string; ageDays?: number } = {},
) {
  const { repo } = ctx;
  const user = await repo.createUser({
    globalUserId: opts.globalUserId ?? null,
    locale: "fr-CA",
    displayName: "Test",
    phoneVerifiedAt: opts.verified === false ? null : new Date(),
  });
  const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
  // Accounts older than the 14-day "new" window unless asked otherwise.
  repo.accounts.get(account.id)!.createdAt = new Date(Date.now() - (opts.ageDays ?? 60) * 86_400_000);
  if (opts.e911) {
    await repo.upsertE911Address({
      telecomAccountId: account.id,
      phoneNumberId: null,
      customerName: "Test",
      street: "1 rue Sainte-Catherine",
      unit: null,
      city: "Montréal",
      province: "QC",
      postalCode: "H2X 1Y4",
      country: "CA",
      validatedAt: new Date(),
      providerRef: "ADtest",
    });
  }
  if (opts.ack) await repo.addE911Ack({ userId: user.id, noticeVersion: NOTICE, acceptedAt: new Date(), ip: null, appVersion: null, userAgent: null });
  let number;
  if (opts.number) {
    number = await repo.createNumber({
      e164: opts.number,
      twilioSid: `PN-${opts.number}`,
      telecomAccountId: account.id,
      kind: "local",
      state: "active",
      lastActivityAt: new Date(),
      stateChangedAt: new Date(),
    });
  }
  const { accessToken } = await ctx.deps.sessions.issue(user.id);
  return { user, account: (await repo.getAccount(account.id))!, number, token: accessToken, auth: { authorization: `Bearer ${accessToken}` } };
}

/** POSTs a Twilio-signed form webhook. */
export function twilioPost(ctx: Ctx, path: string, params: Record<string, string>, signature?: string) {
  const sig = signature ?? expectedTwilioSignature(AUTH_TOKEN, BASE_URL + path, params);
  return ctx.app.inject({
    method: "POST",
    url: path,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
    payload: new URLSearchParams(params).toString(),
  });
}

export async function handoffJwt(privateKey: CryptoKey, claims: { sub: string; aud?: string; ttl?: number; jti?: string; iss?: string }) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "tk-1" })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? "mimt")
    .setSubject(claims.sub)
    .setJti(claims.jti ?? crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${claims.ttl ?? 60}s`)
    .sign(privateKey);
}
