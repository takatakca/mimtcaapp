// The app's API client: one HttpClient (http.ts) plus typed endpoints from the shared contract.
// With VITE_MOCK_API=1 requests go to the in-browser fixture API (mock.ts) instead of the network.
import type {
  AuthTokensResponse,
  CallsResponse,
  CheckoutRequest,
  CheckoutResponse,
  ConsentRequest,
  ConsentResponse,
  ConversationsResponse,
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
  SendMessageRequest,
  TakatakExchangeRequest,
  UpdateMeRequest,
  UpdateMeResponse,
  VoicemailsResponse,
  VoiceTokenResponse,
  BillingPortalResponse,
  ReplySuggestionsResponse,
  AiStatusResponse,
} from "@mimt/shared";
import { env } from "../env";
import { createHttpClient, type FetchLike } from "./http";
import { createTokenStore } from "./tokens";
import { businessEndpoints } from "./business";
import { catalogEndpoints } from "./catalog";

let locale: Locale = "fr-CA";
const signedOutListeners = new Set<() => void>();

export function setApiLocale(l: Locale): void {
  locale = l;
}

/** Called when the refresh token is rejected: the app must go back to sign-in. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

const fetchImpl: FetchLike = env.mock
  ? (input, init) => import("./mock").then((m) => m.mockFetch(input, init))
  : (input, init) => fetch(input, init);

export const http = createHttpClient({
  baseUrl: env.apiUrl,
  fetch: fetchImpl,
  store: createTokenStore(),
  appVersion: env.appVersion,
  getLocale: () => locale,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
});

const { request } = http;

export const api = {
  // Auth (flow A in docs/MIMT-MVP.md §4: the API exchanges the code server-to-server).
  takatakExchange: (body: TakatakExchangeRequest) =>
    request<AuthTokensResponse>("POST", "/v1/auth/takatak/exchange", { body, auth: false }),
  otpStart: (phone: string) => request<OtpStartResponse>("POST", "/v1/auth/otp/start", { body: { phone }, auth: false }),
  /** A wrong or expired code answers 401 (not a session problem: auth is false). */
  otpVerify: (phone: string, code: string) =>
    request<AuthTokensResponse>("POST", "/v1/auth/otp/verify", { body: { phone, code }, auth: false }),
  /** Revokes the refresh-token family server-side. */
  async logout(): Promise<void> {
    const rt = http.refreshToken();
    if (rt) await request<void>("POST", "/v1/auth/logout", { body: { refreshToken: rt }, auth: false }).catch(() => undefined);
    http.signOutLocally();
  },

  me: () => request<MeResponse>("GET", "/v1/me"),
  updateMe: (body: UpdateMeRequest) => request<UpdateMeResponse>("PATCH", "/v1/me", { body }),
  exportData: () => request<MeExportResponse>("GET", "/v1/me/export"),
  deleteAccount: () => request<void>("DELETE", "/v1/me"),
  setConsent: (body: ConsentRequest) => request<ConsentResponse>("POST", "/v1/consents", { body }),

  // 9-1-1
  /** 404 (error.notFound) when no address is registered yet. */
  getE911Address: () => request<E911AddressResponse>("GET", "/v1/e911/address"),
  putE911Address: (body: E911Address) => request<E911AddressResponse>("PUT", "/v1/e911/address", { body }),
  e911Notice: (l: Locale) => request<E911NoticeResponse>("GET", "/v1/e911/notice", { query: { locale: l }, auth: false }),
  e911Ack: (noticeVersion: string) => request<E911AckResponse>("POST", "/v1/e911/acknowledge", { body: { noticeVersion } }),

  // Voice: platform=web selects no push credential (the browser keeps a live signalling socket).
  voiceToken: () => request<VoiceTokenResponse>("GET", "/v1/voice/token", { query: { platform: "web" } }),
  calls: (cursor?: string) => request<CallsResponse>("GET", "/v1/calls", { query: { cursor, limit: 50 } }),

  // Messaging
  conversations: () => request<ConversationsResponse>("GET", "/v1/conversations"),
  /** Newest first; pass nextCursor to load older messages. */
  messages: (peer: string, cursor?: string) =>
    request<MessagesResponse>("GET", `/v1/conversations/${encodeURIComponent(peer)}/messages`, { query: { cursor, limit: 30 } }),
  sendMessage: (body: SendMessageRequest) => request<MessageDto>("POST", "/v1/messages", { body }),
  /** AI reply suggestions (needs the "ai_processing" consent). Never sent automatically. */
  suggestions: (peer: string) =>
    request<ReplySuggestionsResponse>("GET", `/v1/conversations/${encodeURIComponent(peer)}/suggestions`),
  aiStatus: () => request<AiStatusResponse>("GET", "/v1/ai/status"),

  // Voicemail. Each item carries a short-lived signed audioUrl served by the API (no header needed).
  voicemails: () => request<VoicemailsResponse>("GET", "/v1/voicemails"),
  deleteVoicemail: (id: string) => request<void>("DELETE", `/v1/voicemails/${encodeURIComponent(id)}`),

  // Billing (Stripe Checkout on the web; the API decides the success/cancel URLs).
  checkout: (body: CheckoutRequest) => request<CheckoutResponse>("POST", "/v1/billing/checkout", { body }),
  billingPortal: () => request<BillingPortalResponse>("GET", "/v1/billing/portal"),

  ...businessEndpoints(request),
  ...catalogEndpoints(request),
};

export type Api = typeof api;
