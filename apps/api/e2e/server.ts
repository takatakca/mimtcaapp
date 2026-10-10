// End-to-end test server: the real API (buildApp + createDeps, in-memory repository) with a fake Twilio
// gateway and seeded fixtures, for the Playwright suite in e2e/. NOT part of the production image:
// tsconfig.build.json compiles src/ only, so this file never reaches dist/ or the Docker image.
//
// Refuses to start unless MIMT_E2E=1, and always refuses when NODE_ENV=production.
//
//   MIMT_E2E=1 E2E_API_PORT=18181 E2E_WEB_ORIGIN=http://127.0.0.1:4176 pnpm --filter @mimt/api exec tsx e2e/server.ts
//
// Sign-in for the browser: the normal "code par texto" flow. The fake Twilio Verify accepts only
// E2E_OTP_CODE for E2E_PHONE; every other code is refused like a wrong code.
import { pathToFileURL } from "node:url";
import { buildApp } from "../src/app.js";
import { createDeps, createLogger } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import { expectedTwilioSignature, type TwilioGateway } from "../src/gateways/twilio.js";
import {
  E2E_BUSINESS_NAME,
  E2E_NUMBER,
  E2E_OFFER_NAME_FR,
  E2E_OTP_CODE,
  E2E_PEER,
  E2E_PHONE,
  E2E_SMS_BODY,
  E2E_VOICEMAIL_FROM,
  E2E_VOICEMAIL_TRANSCRIPT,
} from "./fixtures.js";

export { E2E_OTP_CODE, E2E_PHONE };

/** Throws unless the e2e server is explicitly enabled and this is not a production environment. */
export function assertE2eAllowed(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === "production") throw new Error("The e2e server never runs with NODE_ENV=production.");
  if (env.MIMT_E2E !== "1") throw new Error("The e2e server needs MIMT_E2E=1 (test-only fake Twilio and fixtures).");
}

/** Fake Twilio: no network. Verify accepts one fixed code for the e2e phone only. */
export function e2eTwilio(): TwilioGateway {
  let n = 0;
  const sid = (prefix: string) => `${prefix}${(++n).toString(16).padStart(32, "0")}`;
  return {
    createVoiceToken: (identity) => ({ token: `e2e-voice-token-${identity}`, expiresAt: new Date(Date.now() + 3600_000) }),
    searchLocalNumbers: async () => [{ e164: "+15145550177", locality: "Montréal", region: "QC" }],
    purchaseNumber: async () => ({ sid: sid("PN") }),
    releaseNumber: async () => {},
    createEmergencyAddress: async () => ({ sid: sid("AD"), validated: true }),
    attachEmergencyAddress: async () => {},
    sendMessage: async () => ({ sid: sid("SM"), status: "queued", segments: 1 }),
    startVerification: async () => {},
    checkVerification: async (phone, code) => phone === E2E_PHONE && code === E2E_OTP_CODE,
    fetchRecording: async () => ({ contentType: "audio/mpeg", body: Buffer.from("ID3") }),
    deleteRecording: async () => {},
  };
}

export async function startE2eServer(env: Record<string, string | undefined> = process.env) {
  assertE2eAllowed(env);
  const port = Number(env.E2E_API_PORT ?? 18181);
  const webOrigin = env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:4176";
  const publicBaseUrl = `http://127.0.0.1:${port}`;
  const authToken = "e2e-twilio-auth-token";

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: env.E2E_LOG_LEVEL ?? "warn",
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_BASE_URL: publicBaseUrl,
    APP_BASE_URL: webOrigin,
    CORS_ORIGINS: webOrigin,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_TWIML_APP_SID: "APe2e",
    TWILIO_VERIFY_SERVICE_SID: "VAe2e",
    PROVISIONING_PROVIDER: "sandbox",
  });
  const log = createLogger(config);
  const deps = createDeps(config, log); // no DATABASE_URL → MemoryRepository; ephemeral keys
  deps.twilio = e2eTwilio();
  const app = await buildApp(deps);
  const { repo } = deps;

  // --- Fixtures -------------------------------------------------------------------------------------
  const now = new Date();
  const user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Essai E2E", phoneE164: E2E_PHONE, phoneVerifiedAt: now });
  const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
  const number = await repo.createNumber({
    e164: E2E_NUMBER,
    twilioSid: "PNe2e",
    telecomAccountId: account.id,
    kind: "local",
    state: "active",
    lastActivityAt: now,
    stateChangedAt: now,
  });

  // Inbound SMS through the real, signed Twilio webhook.
  const smsParams = { MessageSid: `SM${"e".repeat(32)}`, From: E2E_PEER, To: E2E_NUMBER, Body: E2E_SMS_BODY, NumSegments: "1" };
  const sms = await app.inject({
    method: "POST",
    url: "/webhooks/twilio/sms/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": expectedTwilioSignature(authToken, `${publicBaseUrl}/webhooks/twilio/sms/inbound`, smsParams),
    },
    payload: new URLSearchParams(smsParams).toString(),
  });
  if (sms.statusCode !== 200) throw new Error(`e2e seed: inbound SMS answered ${sms.statusCode}`);

  const recordingSid = `RE${"e".repeat(32)}`;
  await repo.createVoicemail({
    telecomAccountId: account.id,
    phoneNumberId: number.id,
    callSid: `CA${"e".repeat(32)}`,
    recordingSid,
    fromNumber: E2E_VOICEMAIL_FROM,
    audioUrl: `https://api.twilio.com/2010-04-01/Accounts/AC${"e".repeat(32)}/Recordings/${recordingSid}`,
    durationS: 14,
  });
  await repo.updateVoicemailByRecordingSid(recordingSid, { transcript: E2E_VOICEMAIL_TRANSCRIPT, transcriptLang: "fr-CA" });

  // A business owned by the e2e user, created through the real route.
  const { accessToken } = await deps.sessions.issue(user.id);
  const biz = await app.inject({
    method: "POST",
    url: "/v1/business",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: E2E_BUSINESS_NAME },
  });
  if (biz.statusCode !== 201) throw new Error(`e2e seed: POST /v1/business answered ${biz.statusCode} ${biz.body}`);

  await repo.catalog.createOffer({
    code: "e2e-mobile-20",
    productLine: "mobile",
    provider: "sandbox",
    providerProductCode: null,
    name: { fr: E2E_OFFER_NAME_FR, en: "Mobile Test 20 GB" },
    description: { fr: "Appels et textos illimités au Canada", en: "Unlimited Canada-wide calls and texts" },
    monthlyPriceCents: 3500,
    setupFeeCents: 0,
    termMonths: 0,
    discountCents: 0,
    attributes: { dataGb: 20, throttleKbps: 512, minutes: null, sms: null, network: "5g", esim: true },
    availableFsas: null,
    status: "active",
  });

  await app.listen({ port, host: "127.0.0.1" });
  log.warn({ port, webOrigin }, "MIMT e2e server ready (fake Twilio, in-memory data). Never use in production.");
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const app = await startE2eServer();
    const stop = () => void app.close().then(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
