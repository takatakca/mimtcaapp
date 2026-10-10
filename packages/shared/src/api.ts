// Shared API contract between apps/api, apps/mobile and apps/web.
// apps/api is the source of truth: route handlers are typed with these shapes so the compiler keeps
// both sides in agreement. All dates are ISO 8601 strings. Every error is an ApiError body.

import type { NumberState } from "./numbers.js";
import type { PlanCode } from "./plans.js";
import type { SpamLabel, VoicemailInsight } from "./ai.js";

export type Locale = "fr-CA" | "en-CA";
export type Direction = "inbound" | "outbound";

/** Body of every non-2xx response. `error` is a stable machine code, `message` is for logs/humans. */
export interface ApiError {
  error: string;
  message: string;
}

// ------------------------------------------------------------------------------------------- auth

/** Returned by POST /v1/auth/takatak/exchange, /v1/auth/refresh and /v1/auth/otp/verify. */
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  /** Seconds until the access token expires. */
  expiresIn: number;
}

/** POST /v1/auth/takatak/exchange (OAuth code + PKCE verifier; the API talks to TAKATAK). */
export interface TakatakExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce?: string;
}

/** POST /v1/auth/refresh and POST /v1/auth/logout (204). */
export interface RefreshRequest {
  refreshToken: string;
}
export type LogoutRequest = RefreshRequest;

/** POST /v1/auth/otp/start → 202 OtpStartResponse. `phone` is Canada/US E.164. */
export interface OtpStartRequest {
  phone: string;
}
export interface OtpStartResponse {
  status: "pending";
}
/** POST /v1/auth/otp/verify → AuthTokensResponse. A wrong code answers 401. */
export interface OtpVerifyRequest {
  phone: string;
  code: string;
}

// ------------------------------------------------------------------------------------------ me

/** GET /v1/me */
export interface MeResponse {
  user: { id: string; globalUserId: string | null; locale: Locale; displayName: string | null };
  account: { id: string; kind: "consumer" | "business"; plan: PlanCode; status: string };
  numbers: Array<{ id: string; e164: string; state: NumberState }>;
  e911: { addressRegistered: boolean; noticeAccepted: boolean; noticeVersion: string };
  usage: { outboundMinutes: number; inboundMinutes: number; outboundSms: number; periodStart: string };
}

/** PATCH /v1/me */
export interface UpdateMeRequest {
  locale?: Locale;
  displayName?: string | null;
}
export interface UpdateMeResponse {
  id: string;
  locale: Locale;
  displayName: string | null;
}

/** DELETE /v1/me → 202 */
export interface DeleteMeResponse {
  status: "pending_deletion";
  deletionScheduledAt: string;
}

/** GET /v1/me/export (Law 25 portability). Sections are documented in apps/api/src/routes/me.ts. */
export interface MeExportResponse {
  exportedAt: string;
  format: "mimt-export-v1";
  [section: string]: unknown;
}

export type ConsentKind =
  | "casl_marketing"
  | "ads_personalised"
  | "call_recording_notice"
  | "privacy_policy"
  | "terms"
  /** Law 25: processing of voicemails/SMS by the AI provider (Anthropic, outside Quebec). See ai.ts. */
  | "ai_processing";

/** POST /v1/consents → 201 ConsentResponse */
export interface ConsentRequest {
  kind: ConsentKind;
  granted: boolean;
  version: string;
  /** Where the consent was given ("mobile", "web"…). Defaults to "app". */
  source?: string;
}
export interface ConsentResponse {
  id: string;
  kind: ConsentKind;
  granted: boolean;
  version: string;
  at: string;
}

// ------------------------------------------------------------------------------------------ 9-1-1

/** PUT /v1/e911/address body. */
export interface E911Address {
  /** Defaults to the user's display name. */
  customerName?: string;
  street: string;
  unit?: string;
  city: string;
  /** Two-letter province or territory code (QC, ON…). */
  province: string;
  /** "H2X 1Y4" (the API normalises spacing and case). */
  postalCode: string;
  country: "CA";
}

/** GET /v1/e911/address (404 when none) and PUT /v1/e911/address. */
export interface E911AddressResponse {
  id: string;
  street: string;
  unit: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: "CA";
  validated: boolean;
  providerRegistered: boolean;
}

export interface E911NoticeText {
  title: string;
  paragraphs: string[];
  acknowledgement: string;
}

/** GET /v1/e911/notice?locale=fr-CA|en-CA. Both languages are always returned, French first. */
export interface E911NoticeResponse {
  version: string;
  /** The language the app should show. */
  locale: Locale;
  reviewStatus: string;
  fr: E911NoticeText;
  en: E911NoticeText;
}

/** POST /v1/e911/acknowledge → 201. The app version is read from the X-App-Version header. */
export interface E911AckRequest {
  noticeVersion: string;
}
export interface E911AckResponse {
  noticeVersion: string;
  acceptedAt: string;
}

// ------------------------------------------------------------------------------------------ numbers

export interface AvailableNumber {
  e164: string;
  locality: string | null;
  region: string | null;
}

/** GET /v1/numbers/available?areaCode=514 */
export interface AvailableNumbersResponse {
  /** The area code actually searched (falls back through Quebec codes when none is given). */
  areaCode: string | null;
  numbers: AvailableNumber[];
}

/** POST /v1/numbers/claim → 201 ClaimNumberResponse */
export interface ClaimNumberRequest {
  e164: string;
}
export interface ClaimNumberResponse {
  id: string;
  e164: string;
  state: NumberState;
}

// ------------------------------------------------------------------------------------------ voice

export type VoicePlatform = "ios" | "android" | "web";

/** GET /v1/voice/token?platform=ios|android|web (platform selects the VoIP push credential). */
export interface VoiceTokenResponse {
  token: string;
  identity: string;
  expiresAt: string;
}

export interface CallRecord {
  id: string;
  direction: Direction;
  kind: "pstn" | "app" | "emergency";
  /** The other party (E.164, or "911"). */
  peer: string;
  /** Our MIMT number, or null for app-to-app and 9-1-1 calls without one. */
  ourNumber: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  /** Inbound call that was never answered. */
  missed: boolean;
  /** Set when the call looks like spam/fraud: the app shows « Appel suspect ». Absent when the call looks fine. */
  spamLabel?: SpamLabel;
}

/** GET /v1/calls?cursor&limit (newest first). */
export interface CallsResponse {
  calls: CallRecord[];
  nextCursor: string | null;
}

// ------------------------------------------------------------------------------------------ messaging

/** POST /v1/messages → 201 MessageDto */
export interface SendMessageRequest {
  from: string;
  to: string;
  body: string;
  /** https URLs, MMS plans only. */
  mediaUrls?: string[];
}

export interface MessageDto {
  id: string;
  direction: Direction;
  ourNumber: string;
  peer: string;
  body: string;
  /** Twilio status: queued, sent, delivered, undelivered, failed, received… */
  status: string;
  segments: number;
  numMedia: number;
  createdAt: string;
  /** Inbound messages only, when flagged: the app shows « Message suspect ». */
  spamLabel?: SpamLabel;
}

export interface ConversationDto {
  peer: string;
  ourNumber: string;
  lastMessageAt: string;
  lastMessage: { id: string; direction: Direction; preview: string };
}

/** GET /v1/conversations (most recent first). */
export interface ConversationsResponse {
  conversations: ConversationDto[];
}

/** GET /v1/conversations/:peer/messages?cursor&limit — NEWEST FIRST; nextCursor loads older ones. */
export interface MessagesResponse {
  messages: MessageDto[];
  nextCursor: string | null;
}

// ------------------------------------------------------------------------------------------ voicemail

export interface VoicemailDto {
  id: string;
  from: string | null;
  durationS: number | null;
  transcript: string | null;
  createdAt: string;
  listened: boolean;
  /**
   * Short-lived URL to GET the audio through the API (no Twilio credentials, no bearer token
   * needed). Null when no recording is available. Re-list to get a fresh one once it expires.
   */
  audioUrl: string | null;
  audioUrlExpiresAt: string | null;
  /** AI summary (Claude), present only when the user consented to "ai_processing" and it was produced. */
  ai?: VoicemailInsight;
}

/** GET /v1/voicemails (newest first). DELETE /v1/voicemails/:id → 204. */
export interface VoicemailsResponse {
  voicemails: VoicemailDto[];
}

// ------------------------------------------------------------------------------------------ billing

export type PaidPlanCode = Exclude<PlanCode, "free">;
export type AddOnCode = "extra_number" | "minutes_250" | "intl_credit";

/** POST /v1/billing/checkout: exactly one of plan or addon. */
export interface CheckoutRequest {
  plan?: PaidPlanCode;
  addon?: AddOnCode;
  interval?: "month" | "year";
  quantity?: number;
  /** International credit amount, CAD cents. */
  amountCents?: number;
}
export interface CheckoutResponse {
  /** Stripe Checkout URL to open in the browser. */
  checkoutUrl: string;
  sessionId: string;
}

/** GET /v1/billing/portal */
export interface BillingPortalResponse {
  portalUrl: string;
}

// ------------------------------------------------------------------------------------------ rewards

/** POST /v1/rewards/claim — answers 501 not_implemented until AdMob SSV verification exists. */
export interface RewardClaimRequest {
  kind: "rewarded_ad_10min";
  adUnitId: string;
}
export interface RewardClaimResponse {
  creditedMinutes: number;
}

// ------------------------------------------------------------------------------------------ push

/** POST /v1/push/register → 204. Native APNs (ios) or FCM (android) device token. */
export interface PushRegisterRequest {
  token: string;
  platform: "ios" | "android";
  kind: "messages";
}
