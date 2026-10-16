// Typed client for the MIMT API (apps/api). Handles bearer tokens, single-flight refresh on expiry
// or 401, and maps every failure to a translated message key (see errors.ts).
import Constants from "expo-constants";
import { setPersonalisedConsent } from "../services/ads";
import { ApiClientError, errorKeyFor } from "./errors";
import { clearSession, loadSession, saveSession, toSession, type StoredSession } from "./tokens";
import type {
  AuthTokens,
  AvailableNumbersResponse,
  BlockedNumberDto,
  BlockNumberRequest,
  BlocksResponse,
  CallsResponse,
  CheckoutResponse,
  ClaimNumberResponse,
  ConsentRequest,
  ConsentResponse,
  ConsentsResponse,
  ConversationsResponse,
  CreateMediaUploadRequest,
  CreateMediaUploadResponse,
  RecordGreetingByCallResponse,
  UpdateVoicemailSettingsRequest,
  VoicemailSettingsDto,
  E911AckRequest,
  E911AckResponse,
  E911Address,
  E911AddressResponse,
  E911NoticeResponse,
  Locale,
  MeExportResponse,
  MeResponse,
  MessageDto,
  MessagesResponse,
  OtpStartResponse,
  PaidPlanCode,
  PushRegisterRequest,
  RateResponse,
  RedeemReferralRequest,
  RedeemReferralResponse,
  ReferralsResponse,
  RewardClaimRequest,
  RewardClaimResponse,
  SendMessageRequest,
  SubscriptionAddOnCode,
  TakatakExchangeRequest,
  UpdateMeRequest,
  UpdateMeResponse,
  VoicemailsResponse,
  VoicePlatform,
  VoiceTokenResponse,
} from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://api.mimt.ca").replace(/\/+$/, "");
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface RequestOptions {
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | undefined>;
}

let session: StoredSession | null = null;
let sessionLoaded = false;
let refreshing: Promise<StoredSession | null> | null = null;
let acceptLanguage: Locale = "fr-CA";
const signedOutListeners = new Set<() => void>();

/** Called when the refresh token is rejected: the app must go back to sign-in. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

export function setApiLocale(locale: Locale): void {
  acceptLanguage = locale;
}

async function getSession(): Promise<StoredSession | null> {
  if (!sessionLoaded) {
    session = await loadSession();
    sessionLoaded = true;
  }
  return session;
}

export async function hasSession(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function setTokens(tokens: AuthTokens): Promise<void> {
  session = toSession(tokens);
  sessionLoaded = true;
  await saveSession(session);
}

export async function signOutLocally(): Promise<void> {
  session = null;
  sessionLoaded = true;
  // App/account switching must never reuse the previous user's local ad consent.
  // An unavailable SecureStore must not prevent session revocation.
  await setPersonalisedConsent(false, false).catch(() => undefined);
  try {
    await clearSession();
  } finally {
    signedOutListeners.forEach((l) => l());
  }
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const qs = query
    ? Object.entries(query)
        .filter((e): e is [string, string] => e[1] !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  return `${API_URL}${path}${qs ? `?${qs}` : ""}`;
}

async function rawFetch(method: Method, path: string, opts: RequestOptions, accessToken?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": acceptLanguage,
    "X-App-Version": APP_VERSION,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiClientError(null, "network", "error.network", e instanceof Error ? e.message : "network error");
  }
}

async function refreshSession(): Promise<StoredSession | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const current = await getSession();
      if (!current) return null;
      const res = await rawFetch("POST", "/v1/auth/refresh", { body: { refreshToken: current.refreshToken } });
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) await signOutLocally();
        return null;
      }
      const tokens = (await res.json()) as AuthTokens;
      await setTokens(tokens);
      return session;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function validAccessToken(): Promise<string | undefined> {
  const s = await getSession();
  if (!s) return undefined;
  if (s.expiresAt - 30_000 > Date.now()) return s.accessToken;
  return (await refreshSession())?.accessToken;
}

async function toError(res: Response): Promise<ApiClientError> {
  let code: string | null = null;
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    code = body.error ?? null;
    message = body.message ?? message;
  } catch {
    // Non-JSON error body.
  }
  return new ApiClientError(res.status, code, errorKeyFor(res.status, code), message);
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth ?? true;
  let res = await rawFetch(method, path, opts, auth ? await validAccessToken() : undefined);
  if (auth && res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) throw new ApiClientError(401, "unauthorized", "error.session", "session expired");
    res = await rawFetch(method, path, opts, refreshed.accessToken);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------------------- endpoints

/** Revokes the refresh-token family server-side (POST /v1/auth/logout takes the refresh token, not a bearer). */
async function logout(): Promise<void> {
  const current = await getSession();
  if (!current) return;
  await request<void>("POST", "/v1/auth/logout", { body: { refreshToken: current.refreshToken }, auth: false });
}

export const api = {
  // Auth (flow A in docs/MIMT-MVP.md §4: the API exchanges the code server-to-server).
  takatakExchange: (body: TakatakExchangeRequest) =>
    request<AuthTokens>("POST", "/v1/auth/takatak/exchange", { body, auth: false }),
  otpStart: (phone: string) => request<OtpStartResponse>("POST", "/v1/auth/otp/start", { body: { phone }, auth: false }),
  /** A wrong or expired code answers 401 (not a session problem). */
  otpVerify: (phone: string, code: string) =>
    request<AuthTokens>("POST", "/v1/auth/otp/verify", { body: { phone, code }, auth: false }),
  logout,

  me: () => request<MeResponse>("GET", "/v1/me"),
  updateMe: (body: UpdateMeRequest) => request<UpdateMeResponse>("PATCH", "/v1/me", { body }),
  /** Law 25 portability: the full export as JSON (the app hands it to the share sheet). */
  exportData: () => request<MeExportResponse>("GET", "/v1/me/export"),
  deleteAccount: () => request<void>("DELETE", "/v1/me"),
  consents: () => request<ConsentsResponse>("GET", "/v1/consents"),
  setConsent: (body: ConsentRequest) => request<ConsentResponse>("POST", "/v1/consents", { body }),

  // Call blocking (inbound only; 9-1-1 can never be blocked). Forwarding and do not disturb go through updateMe.
  blocks: () => request<BlocksResponse>("GET", "/v1/blocks"),
  block: (body: BlockNumberRequest) => request<BlockedNumberDto>("POST", "/v1/blocks", { body }),
  unblock: (id: string) => request<void>("DELETE", `/v1/blocks/${encodeURIComponent(id)}`),
  unblockNumber: (number: string) => request<void>("DELETE", "/v1/blocks", { query: { number } }),

  // 9-1-1
  /** 404 (error.notFound) when no address is registered yet. */
  getE911Address: () => request<E911AddressResponse>("GET", "/v1/e911/address"),
  putE911Address: (body: E911Address) => request<E911AddressResponse>("PUT", "/v1/e911/address", { body }),
  e911Notice: (locale: Locale) => request<E911NoticeResponse>("GET", "/v1/e911/notice", { query: { locale }, auth: false }),
  /** The app version travels in the X-App-Version header. */
  e911Ack: (body: E911AckRequest) => request<E911AckResponse>("POST", "/v1/e911/acknowledge", { body }),

  // Numbers
  availableNumbers: (areaCode: string) => request<AvailableNumbersResponse>("GET", "/v1/numbers/available", { query: { areaCode } }),
  claimNumber: (e164: string) => request<ClaimNumberResponse>("POST", "/v1/numbers/claim", { body: { e164 } }),

  // Voice. The platform picks the VoIP push credential: without it incoming calls cannot ring the device.
  voiceToken: (platform: VoicePlatform) => request<VoiceTokenResponse>("GET", "/v1/voice/token", { query: { platform } }),
  calls: (cursor?: string) => request<CallsResponse>("GET", "/v1/calls", { query: { cursor } }),

  // Messaging
  conversations: () => request<ConversationsResponse>("GET", "/v1/conversations"),
  /** Newest first; pass nextCursor to load older messages. */
  messages: (peer: string, cursor?: string) =>
    request<MessagesResponse>("GET", `/v1/conversations/${encodeURIComponent(peer)}/messages`, { query: { cursor } }),
  sendMessage: (body: SendMessageRequest) => request<MessageDto>("POST", "/v1/messages", { body }),

  // Voicemail. Each item carries a short-lived signed audioUrl served by the API (no header needed).
  voicemails: () => request<VoicemailsResponse>("GET", "/v1/voicemails"),
  deleteVoicemail: (id: string) => request<void>("DELETE", `/v1/voicemails/${encodeURIComponent(id)}`),

  // Voicemail settings: custom greeting (paid plans) and voicemail to email (courriel).
  voicemailSettings: () => request<VoicemailSettingsDto>("GET", "/v1/voicemail/settings"),
  updateVoicemailSettings: (body: UpdateVoicemailSettingsRequest) =>
    request<VoicemailSettingsDto>("PATCH", "/v1/voicemail/settings", { body }),
  setGreeting: (mediaId: string) => request<VoicemailSettingsDto>("PUT", "/v1/voicemail/greeting", { body: { mediaId } }),
  resetGreeting: () => request<VoicemailSettingsDto>("DELETE", "/v1/voicemail/greeting"),
  recordGreetingByCall: () => request<RecordGreetingByCallResponse>("POST", "/v1/voicemail/greeting/call"),

  // Media: signed upload URL, then the app PUTs the file straight to storage (see services/upload.ts).
  createUpload: (body: CreateMediaUploadRequest) => request<CreateMediaUploadResponse>("POST", "/v1/media/uploads", { body }),

  // Billing (web checkout via Stripe). TODO(store-billing): consumer plans bought inside the iOS/Android
  // app must use Apple/Google in-app purchases (MIMT-MVP §6); this web checkout is for business plans
  // and for testing until IAP is wired. The API decides the success/cancel URLs.
  checkout: (plan: PaidPlanCode, referralCode?: string) =>
    request<CheckoutResponse>("POST", "/v1/billing/checkout", { body: { plan, ...(referralCode ? { referralCode } : {}) } }),
  /** "Sans pub" (3,99 $/mo or 29,99 $/yr). TODO(store-billing): ca.mimt.app.noads.* through IAP in store builds. */
  checkoutAddOn: (addon: SubscriptionAddOnCode, interval: "month" | "year") =>
    request<CheckoutResponse>("POST", "/v1/billing/checkout", { body: { addon, interval } }),
  /** Prepaid international credit (free plan: small top-ups only, see FREE_PLAN_INTL_LIMITS). */
  checkoutIntlCredit: (amountCents: number) =>
    request<CheckoutResponse>("POST", "/v1/billing/checkout", { body: { addon: "intl_credit", amountCents } }),
  /** Per-minute price and whether the call is allowed, shown on the keypad before dialling. */
  rate: (to: string) => request<RateResponse>("GET", "/v1/rates", { query: { to } }),

  // Referrals: my code (created on first call) and status; redeem a friend's code before the first paid plan.
  referrals: () => request<ReferralsResponse>("GET", "/v1/referrals"),
  redeemReferral: (body: RedeemReferralRequest) => request<RedeemReferralResponse>("POST", "/v1/referrals/redeem", { body }),

  // Rewarded ads. The API answers 501 not_implemented until AdMob server-side verification (SSV) exists;
  // this call alone must never be trusted to credit minutes.
  claimReward: (body: RewardClaimRequest) => request<RewardClaimResponse>("POST", "/v1/rewards/claim", { body }),

  // Push (native APNs/FCM device token for message notifications; VoIP push for calls is Twilio's).
  registerPush: (body: PushRegisterRequest) => request<void>("POST", "/v1/push/register", { body }),
};
