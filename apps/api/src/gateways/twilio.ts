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
export type TranscriptLanguage = "fr" | "en";

export interface VoicemailTranscriber {
  /** Starts a transcript of a Twilio recording; returns the transcript SID. */
  start(input: { language: TranscriptLanguage; recordingSid: string; customerKey: string }): Promise<string>;
  /** "pending" until done; the text joins every sentence in order. */
  result(transcriptSid: string): Promise<{ status: "pending" | "completed" | "failed"; text: string | null }>;
  remove(transcriptSid: string): Promise<void>;
}

export interface TwilioGateway {
  createVoiceToken(identity: string, platform: Platform, ttlSeconds: number): { token: string; expiresAt: Date };
  searchLocalNumbers(input: { areaCode?: string; limit: number }): Promise<AvailableNumber[]>;
  purchaseNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string } & NumberFallbacks): Promise<{ sid: string }>;
  releaseNumber(sid: string): Promise<void>;
  createEmergencyAddress(input: EmergencyAddressInput): Promise<{ sid: string; validated: boolean }>;
  attachEmergencyAddress(numberSid: string, addressSid: string): Promise<void>;
  sendMessage(input: { from: string; to: string; body: string; mediaUrls?: string[]; statusCallback: string }): Promise<{ sid: string; status: string; segments: number }>;
  startVerification(phone: string, locale: string): Promise<void>;
  checkVerification(phone: string, code: string): Promise<boolean>;
  /** Downloads a recording (mp3) server-side, so Twilio credentials never reach the client. */
  fetchRecording(input: { recordingSid: string; accountSid?: string }): Promise<{ contentType: string; body: Buffer }>;
  /** Conversation Intelligence post-call transcription (one service per language; voicemail only). */
  intelligence?: VoicemailTranscriber;
  deleteRecording(input: { recordingSid: string; accountSid?: string }): Promise<void>;
  /** Starts or stops recording a live call (MIMT Affaires on-demand recording). Optional: absent → 503. */
  updateCallRecording?(input: { callSid: string; action: "start" | "stop"; statusCallback: string }): Promise<void>;
  /** Downloads inbound MMS media (Twilio media URLs need auth). `url` must pass isTwilioMediaUrl. */
  fetchMedia?(url: string): Promise<{ contentType: string; body: Buffer }>;
  /** Deletes inbound MMS media at Twilio once copied (Law 25 minimisation). */
  deleteMedia?(url: string): Promise<void>;
  /** Reads one number at Twilio (fallback backfill, jobs/numberFallback.ts). Optional: absent → no backfill. */
  fetchNumberConfig?(sid: string): Promise<TwilioNumberConfig>;
  /** Sets only the fallback URLs of one number; voice/SMS URLs and everything else stay as they are. */
  updateNumberFallbacks?(sid: string, fallbacks: NumberFallbacks): Promise<void>;
  /** Places a call whose TwiML comes from `url` (used to record a voicemail greeting by phone). */
  createCall?(input: { to: string; from: string; url: string; statusCallback?: string }): Promise<{ sid: string }>;
}

/** Twilio-hosted fallbacks used when our webhooks fail (docs/MIMT-CALL-RELIABILITY.md). */
export interface NumberFallbacks {
  voiceFallbackUrl?: string;
  smsFallbackUrl?: string;
}

export interface TwilioNumberConfig {
  e164: string;
  dateCreated: Date | null;
  voiceFallbackUrl: string | null;
  smsFallbackUrl: string | null;
}

/** Fallback fields from TWILIO_VOICE_FALLBACK_URL / TWILIO_SMS_FALLBACK_URL; empty when neither is set. */
export function numberFallbacks(config: Pick<Config, "TWILIO_VOICE_FALLBACK_URL" | "TWILIO_SMS_FALLBACK_URL">): NumberFallbacks {
  return {
    ...(config.TWILIO_VOICE_FALLBACK_URL ? { voiceFallbackUrl: config.TWILIO_VOICE_FALLBACK_URL } : {}),
    ...(config.TWILIO_SMS_FALLBACK_URL ? { smsFallbackUrl: config.TWILIO_SMS_FALLBACK_URL } : {}),
  };
}

/** Twilio parameters for the fallbacks (always POST, like our own webhooks). */
export function fallbackParams(f: NumberFallbacks) {
  return {
    ...(f.voiceFallbackUrl ? { voiceFallbackUrl: f.voiceFallbackUrl, voiceFallbackMethod: "POST" as const } : {}),
    ...(f.smsFallbackUrl ? { smsFallbackUrl: f.smsFallbackUrl, smsFallbackMethod: "POST" as const } : {}),
  };
}

const TWILIO_MEDIA_URL = /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\/Messages\/(MM|SM)[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/i;

/** Only Twilio's own media URLs are fetched with credentials (no SSRF through webhook parameters). */
export function isTwilioMediaUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && TWILIO_MEDIA_URL.test(url);
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
    if (config.VOICEMAIL_TRANSCRIPTION === "intelligence") this.intelligence = new IntelligenceTranscriber(this.client);
  }

  readonly intelligence?: VoicemailTranscriber;

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

  async purchaseNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string } & NumberFallbacks) {
    // Inbound voice goes straight to our inbound webhook (not the TwiML App, which handles client-originated calls).
    const n = await this.client.incomingPhoneNumbers.create({
      phoneNumber: input.e164,
      voiceUrl: input.voiceUrl,
      voiceMethod: "POST",
      smsUrl: input.smsUrl,
      smsMethod: "POST",
      statusCallback: input.statusCallback,
      statusCallbackMethod: "POST",
      ...fallbackParams(input),
      ...(input.emergencyAddressSid ? { emergencyAddressSid: input.emergencyAddressSid } : {}),
    });
    return { sid: n.sid };
  }

  async fetchNumberConfig(sid: string): Promise<TwilioNumberConfig> {
    const n = await this.client.incomingPhoneNumbers(sid).fetch();
    return {
      e164: n.phoneNumber,
      dateCreated: n.dateCreated ? new Date(n.dateCreated) : null,
      voiceFallbackUrl: n.voiceFallbackUrl || null,
      smsFallbackUrl: n.smsFallbackUrl || null,
    };
  }

  async updateNumberFallbacks(sid: string, fallbacks: NumberFallbacks) {
    const params = fallbackParams(fallbacks);
    if (Object.keys(params).length) await this.client.incomingPhoneNumbers(sid).update(params);
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

  async fetchMedia(url: string) {
    if (!isTwilioMediaUrl(url)) throw new Error("not a Twilio media URL");
    // Twilio answers with a redirect to its CDN; fetch drops the authorization header on the cross-origin hop.
    const res = await fetch(url, { headers: { authorization: this.basicAuth() }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Twilio media fetch failed with HTTP ${res.status}`);
    return { contentType: res.headers.get("content-type") ?? "application/octet-stream", body: Buffer.from(await res.arrayBuffer()) };
  }

  async deleteMedia(url: string) {
    if (!isTwilioMediaUrl(url)) throw new Error("not a Twilio media URL");
    const res = await fetch(`${url}.json`, { method: "DELETE", headers: { authorization: this.basicAuth() } });
    if (!res.ok && res.status !== 404) throw new Error(`Twilio media delete failed with HTTP ${res.status}`);
  }

  async createCall(input: { to: string; from: string; url: string; statusCallback?: string }) {
    const call = await this.client.calls.create({
      to: input.to,
      from: input.from,
      url: input.url,
      method: "POST",
      timeout: 25,
      ...(input.statusCallback ? { statusCallback: input.statusCallback } : {}),
    });
    return { sid: call.sid };
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

/**
 * Voicemail transcription in French or English with Conversation Intelligence. A service holds one language
 * (French is fr-FR: Twilio has no fr-CA), so MIMT keeps one per language, found by unique name or created on
 * first use with auto-transcribe and data logging off. Recordings and transcripts are deleted once read.
 */
class IntelligenceTranscriber implements VoicemailTranscriber {
  private readonly services = new Map<TranscriptLanguage, Promise<string>>();

  constructor(private readonly client: twilio.Twilio) {}

  private service(language: TranscriptLanguage): Promise<string> {
    let sid = this.services.get(language);
    if (!sid) {
      sid = this.findOrCreate(language);
      sid.catch(() => this.services.delete(language));
      this.services.set(language, sid);
    }
    return sid;
  }

  private async findOrCreate(language: TranscriptLanguage) {
    const uniqueName = `mimt-voicemail-${language}`;
    const existing = (await this.client.intelligence.v2.services.list({ limit: 100 })).find((s) => s.uniqueName === uniqueName);
    if (existing) return existing.sid;
    const created = await this.client.intelligence.v2.services.create({
      uniqueName,
      friendlyName: `MIMT messagerie vocale (${language})`,
      languageCode: language === "fr" ? "fr-FR" : "en-US",
      autoTranscribe: false,
      dataLogging: false,
    });
    return created.sid;
  }

  async start(input: { language: TranscriptLanguage; recordingSid: string; customerKey: string }) {
    const serviceSid = await this.service(input.language);
    const t = await this.client.intelligence.v2.transcripts.create({
      serviceSid,
      channel: { media_properties: { source_sid: input.recordingSid } },
      customerKey: input.customerKey,
    });
    return t.sid;
  }

  async result(transcriptSid: string): Promise<{ status: "pending" | "completed" | "failed"; text: string | null }> {
    const t = await this.client.intelligence.v2.transcripts(transcriptSid).fetch();
    if (t.status === "failed" || t.status === "canceled" || t.status === "error") return { status: "failed", text: null };
    if (t.status !== "completed") return { status: "pending", text: null };
    const sentences = await this.client.intelligence.v2.transcripts(transcriptSid).sentences.list({ limit: 1000 });
    const text = sentences
      .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
      .map((x) => x.transcript.trim())
      .filter(Boolean)
      .join(" ");
    return { status: "completed", text: text || null };
  }

  async remove(transcriptSid: string) {
    await this.client.intelligence.v2.transcripts(transcriptSid).remove();
  }
}
