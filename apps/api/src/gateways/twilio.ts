import twilio from "twilio";
import type { Config } from "../config.js";

export type Platform = "ios" | "android" | "web";

export interface AvailableNumber {
  e164: string;
  locality: string | null;
  region: string | null;
}

export interface EmergencyAddressInput {
  customerName: string;
  street: string;
  unit: string | null;
  city: string;
  province: string;
  postalCode: string;
}

/** Everything MIMT asks of Twilio, behind one interface so tests can mock it. */
export interface TwilioGateway {
  createVoiceToken(identity: string, platform: Platform, ttlSeconds: number): { token: string; expiresAt: Date };
  searchLocalNumbers(input: { areaCode?: string; limit: number }): Promise<AvailableNumber[]>;
  purchaseNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string }): Promise<{ sid: string }>;
  releaseNumber(sid: string): Promise<void>;
  createEmergencyAddress(input: EmergencyAddressInput): Promise<{ sid: string; validated: boolean }>;
  attachEmergencyAddress(numberSid: string, addressSid: string): Promise<void>;
  sendMessage(input: { from: string; to: string; body: string; mediaUrls?: string[]; statusCallback: string }): Promise<{ sid: string; status: string; segments: number }>;
  startVerification(phone: string, locale: string): Promise<void>;
  checkVerification(phone: string, code: string): Promise<boolean>;
  /** Downloads a recording (mp3) server-side, so Twilio credentials never reach the client. */
  fetchRecording(input: { recordingSid: string; accountSid?: string }): Promise<{ contentType: string; body: Buffer }>;
  deleteRecording(input: { recordingSid: string; accountSid?: string }): Promise<void>;
  /** Starts or stops recording a live call (MIMT Affaires on-demand recording). Optional: absent → 503. */
  updateCallRecording?(input: { callSid: string; action: "start" | "stop"; statusCallback: string }): Promise<void>;
}

const RECORDING_SID = /^RE[0-9a-f]{32}$/i;
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;

/**
 * Account SID of a Twilio recording URL ("https://api.twilio.com/2010-04-01/Accounts/AC…/Recordings/RE…"),
 * so recordings in sub-accounts are fetched from the right account. Anything else is ignored.
 */
export function recordingAccountSid(url: string | null | undefined): string | undefined {
  const m = url ? /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Recordings\//i.exec(url) : null;
  return m?.[1];
}

export class TwilioRestGateway implements TwilioGateway {
  private readonly client: twilio.Twilio;

  constructor(private readonly config: Config) {
    const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = config;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) throw new Error("Twilio is not configured");
    this.client = twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { accountSid: TWILIO_ACCOUNT_SID, autoRetry: true, maxRetries: 2 });
  }

  createVoiceToken(identity: string, platform: Platform, ttlSeconds: number) {
    const c = this.config;
    const token = new twilio.jwt.AccessToken(c.TWILIO_ACCOUNT_SID!, c.TWILIO_API_KEY_SID!, c.TWILIO_API_KEY_SECRET!, { identity, ttl: ttlSeconds });
    const pushCredentialSid =
      platform === "ios" ? c.TWILIO_PUSH_CREDENTIAL_SID_IOS : platform === "android" ? c.TWILIO_PUSH_CREDENTIAL_SID_ANDROID : undefined;
    token.addGrant(
      new twilio.jwt.AccessToken.VoiceGrant({
        outgoingApplicationSid: c.TWILIO_TWIML_APP_SID,
        incomingAllow: true,
        ...(pushCredentialSid ? { pushCredentialSid } : {}),
      }),
    );
    return { token: token.toJwt(), expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async searchLocalNumbers({ areaCode, limit }: { areaCode?: string; limit: number }) {
    const list = await this.client.availablePhoneNumbers("CA").local.list({
      ...(areaCode ? { areaCode: Number(areaCode) } : {}),
      voiceEnabled: true,
      smsEnabled: true,
      limit,
    });
    return list.map((n) => ({ e164: n.phoneNumber, locality: n.locality || null, region: n.region || null }));
  }

  async purchaseNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string }) {
    // Inbound voice goes straight to our inbound webhook (not the TwiML App, which handles client-originated calls).
    const n = await this.client.incomingPhoneNumbers.create({
      phoneNumber: input.e164,
      voiceUrl: input.voiceUrl,
      voiceMethod: "POST",
      smsUrl: input.smsUrl,
      smsMethod: "POST",
      statusCallback: input.statusCallback,
      statusCallbackMethod: "POST",
      ...(input.emergencyAddressSid ? { emergencyAddressSid: input.emergencyAddressSid } : {}),
    });
    return { sid: n.sid };
  }

  async releaseNumber(sid: string) {
    await this.client.incomingPhoneNumbers(sid).remove();
  }

  async createEmergencyAddress(input: EmergencyAddressInput) {
    const a = await this.client.addresses.create({
      customerName: input.customerName,
      street: input.street,
      ...(input.unit ? { streetSecondary: input.unit } : {}),
      city: input.city,
      region: input.province,
      postalCode: input.postalCode,
      isoCountry: "CA",
      emergencyEnabled: true,
      autoCorrectAddress: false,
    });
    return { sid: a.sid, validated: Boolean(a.validated) };
  }

  async attachEmergencyAddress(numberSid: string, addressSid: string) {
    await this.client.incomingPhoneNumbers(numberSid).update({ emergencyAddressSid: addressSid, emergencyStatus: "Active" });
  }

  async sendMessage(input: { from: string; to: string; body: string; mediaUrls?: string[]; statusCallback: string }) {
    const m = await this.client.messages.create({
      from: input.from,
      to: input.to,
      body: input.body,
      statusCallback: input.statusCallback,
      ...(input.mediaUrls?.length ? { mediaUrl: input.mediaUrls } : {}),
    });
    return { sid: m.sid, status: m.status, segments: Number(m.numSegments) || 1 };
  }

  private verifyService() {
    if (!this.config.TWILIO_VERIFY_SERVICE_SID) throw new Error("TWILIO_VERIFY_SERVICE_SID is not set");
    return this.client.verify.v2.services(this.config.TWILIO_VERIFY_SERVICE_SID);
  }

  async startVerification(phone: string, locale: string) {
    await this.verifyService().verifications.create({ to: phone, channel: "sms", locale: locale.startsWith("fr") ? "fr" : "en" });
  }

  async checkVerification(phone: string, code: string) {
    const check = await this.verifyService().verificationChecks.create({ to: phone, code });
    return check.status === "approved";
  }

  private recordingUrl(input: { recordingSid: string; accountSid?: string }, ext = "") {
    const accountSid = input.accountSid ?? this.config.TWILIO_ACCOUNT_SID!;
    // Both SIDs are validated so nothing user-controlled can change the request path.
    if (!RECORDING_SID.test(input.recordingSid) || !ACCOUNT_SID.test(accountSid)) throw new Error("invalid recording reference");
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${input.recordingSid}${ext}`;
  }

  private basicAuth() {
    const { TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = this.config;
    return `Basic ${Buffer.from(`${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}`).toString("base64")}`;
  }

  async fetchRecording(input: { recordingSid: string; accountSid?: string }) {
    const res = await fetch(this.recordingUrl(input, ".mp3"), { headers: { authorization: this.basicAuth() }, redirect: "follow" });
    if (!res.ok) throw new Error(`Twilio recording fetch failed with HTTP ${res.status}`);
    return { contentType: res.headers.get("content-type") ?? "audio/mpeg", body: Buffer.from(await res.arrayBuffer()) };
  }

  async deleteRecording(input: { recordingSid: string; accountSid?: string }) {
    const res = await fetch(this.recordingUrl(input, ".json"), { method: "DELETE", headers: { authorization: this.basicAuth() } });
    if (!res.ok && res.status !== 404) throw new Error(`Twilio recording delete failed with HTTP ${res.status}`);
  }

  async updateCallRecording(input: { callSid: string; action: "start" | "stop"; statusCallback: string }) {
    const call = this.client.calls(input.callSid);
    if (input.action === "start") {
      await call.recordings.create({
        recordingChannels: "dual",
        recordingStatusCallback: input.statusCallback,
        recordingStatusCallbackMethod: "POST",
        recordingStatusCallbackEvent: ["completed"],
      });
    } else {
      await call.recordings("Twilio.CURRENT").update({ status: "stopped" });
    }
  }

  /** Twilio totalprice for a window, in USD. Used by the daily cost report. */
  async usagePriceUsd(start: Date, end: Date): Promise<number | null> {
    const records = await this.client.usage.records.list({ category: "totalprice", startDate: start, endDate: end, limit: 1 });
    const price = records[0]?.price;
    return price == null || Number.isNaN(Number(price)) ? null : Number(price);
  }
}

/** Validates X-Twilio-Signature against PUBLIC_BASE_URL + the request path and query. */
export function validateTwilioSignature(authToken: string, signature: string | undefined, url: string, params: Record<string, unknown>): boolean {
  if (!signature) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

export const expectedTwilioSignature = (authToken: string, url: string, params: Record<string, unknown>) =>
  twilio.getExpectedTwilioSignature(authToken, url, params);
