// Consumer endpoints of the MIMT API (profile, consents, 9-1-1, voice, texts, voicemail, call
// controls, media, billing). Paths and shapes follow apps/api/src/routes/*.ts and @mimt/shared;
// contract.test.ts checks every path and method against the API route files.
import type {
  AffiliateAttributionResponse,
  AffiliateDashboardResponse,
  AiStatusResponse,
  AuthTokensResponse,
  BillingPortalResponse,
  BlockedNumberDto,
  BlockNumberRequest,
  BlocksResponse,
  CallsResponse,
  CheckoutRequest,
  CheckoutResponse,
  ConsentRequest,
  ConsentResponse,
  ConsentsResponse,
  ConversationsResponse,
  CreateMediaUploadRequest,
  CreateMediaUploadResponse,
  DeleteMeResponse,
  E911AckResponse,
  E911Address,
  E911AddressResponse,
  E911NoticeResponse,
  HandleResponse,
  HelpChatRequest,
  HelpChatResponse,
  Locale,
  MeExportResponse,
  MeResponse,
  MessageDto,
  MessagesResponse,
  MissionsResponse,
  NumberHoldResponse,
  OtpStartResponse,
  ReferralsResponse,
  RecordGreetingByCallResponse,
  ReplySuggestionsResponse,
  SendMessageRequest,
  SetGreetingRequest,
  TakatakExchangeRequest,
  UpdateMeRequest,
  UpdateMeResponse,
  UpdateVoicemailSettingsRequest,
  VoicemailDto,
  VoicemailSettingsDto,
  VoicemailsResponse,
  VoiceTokenResponse,
} from "@mimt/shared";
import type { HttpClient } from "./http";
import { checkoutAffiliate } from "../lib/affiliate";

const seg = (s: string) => encodeURIComponent(s);

export function coreEndpoints(request: HttpClient["request"]) {
  return {
    // Auth (flow A in docs/MIMT-MVP.md §4: the API exchanges the code server-to-server).
    takatakExchange: (body: TakatakExchangeRequest) =>
      request<AuthTokensResponse>("POST", "/v1/auth/takatak/exchange", { body, auth: false }),
    otpStart: (phone: string) => request<OtpStartResponse>("POST", "/v1/auth/otp/start", { body: { phone }, auth: false }),
    /** A wrong or expired code answers 401 (not a session problem: auth is false). */
    otpVerify: (phone: string, code: string) =>
      request<AuthTokensResponse>("POST", "/v1/auth/otp/verify", { body: { phone, code }, auth: false }),

    me: () => request<MeResponse>("GET", "/v1/me"),
    /** Profile and call settings (forwarding, do not disturb, blocked-call action: callControls.ts). */
    updateMe: (body: UpdateMeRequest) => request<UpdateMeResponse>("PATCH", "/v1/me", { body }),
    exportData: () => request<MeExportResponse>("GET", "/v1/me/export"),
    /** 202: deletion scheduled, numbers quarantined. */
    deleteAccount: () => request<DeleteMeResponse>("DELETE", "/v1/me"),
    consents: () => request<ConsentsResponse>("GET", "/v1/consents"),
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

    // Call blocking (9-1-1 can never be blocked: 400 cannot_block_emergency).
    blocks: () => request<BlocksResponse>("GET", "/v1/blocks"),
    /** 201 when added, 200 when the number was already blocked. */
    blockNumber: (body: BlockNumberRequest) => request<BlockedNumberDto>("POST", "/v1/blocks", { body }),
    unblock: (blockId: string) => request<void>("DELETE", `/v1/blocks/${seg(blockId)}`),
    /** Unblock by number (call log and thread menus know the number, not the row id). */
    unblockNumber: (number: string) => request<void>("DELETE", "/v1/blocks", { query: { number } }),

    // Messaging
    conversations: () => request<ConversationsResponse>("GET", "/v1/conversations"),
    /** Newest first; pass nextCursor to load older messages. */
    messages: (peer: string, cursor?: string) =>
      request<MessagesResponse>("GET", `/v1/conversations/${seg(peer)}/messages`, { query: { cursor, limit: 30 } }),
    sendMessage: (body: SendMessageRequest) => request<MessageDto>("POST", "/v1/messages", { body }),
    getHandle: () => request<HandleResponse>("GET", "/v1/me/handle"),
    webPushKey: () => request<{ publicKey: string }>("GET", "/v1/push/web/key", { auth: false }),
    webPushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<void>("POST", "/v1/push/web/subscribe", { body }),
    webPushUnsubscribe: (endpoint: string) => request<void>("POST", "/v1/push/web/unsubscribe", { body: { endpoint } }),
    setHandle: (handle: string) => request<HandleResponse>("PUT", "/v1/me/handle", { body: { handle } }),
    /** AI reply suggestions (needs the "ai_processing" consent). Never sent automatically. */
    suggestions: (peer: string) => request<ReplySuggestionsResponse>("GET", `/v1/conversations/${seg(peer)}/suggestions`),
    aiStatus: () => request<AiStatusResponse>("GET", "/v1/ai/status"),
    help: (body: HelpChatRequest) => request<HelpChatResponse>("POST", "/v1/ai/help", { body }),

    // Media (MMS photos, voicemail greeting): signed upload URL, then PUT the bytes (media.ts).
    createUpload: (body: CreateMediaUploadRequest) => request<CreateMediaUploadResponse>("POST", "/v1/media/uploads", { body }),

    // Voicemail. Each item carries a short-lived signed audioUrl served by the API (no header needed).
    voicemails: () => request<VoicemailsResponse>("GET", "/v1/voicemails"),
    deleteVoicemail: (id: string) => request<void>("DELETE", `/v1/voicemails/${seg(id)}`),
    /** AI summary on demand (needs the "ai_processing" consent and vm_transcription): the updated voicemail. */
    summarizeVoicemail: (id: string) => request<VoicemailDto>("POST", `/v1/voicemails/${seg(id)}/summary`),
    voicemailSettings: () => request<VoicemailSettingsDto>("GET", "/v1/voicemail/settings"),
    /** 403 vm_email_not_in_plan, 409 no_email. */
    updateVoicemailSettings: (body: UpdateVoicemailSettingsRequest) =>
      request<VoicemailSettingsDto>("PATCH", "/v1/voicemail/settings", { body }),
    /** Activates an uploaded greeting (purpose "greeting"). */
    setGreeting: (body: SetGreetingRequest) => request<VoicemailSettingsDto>("PUT", "/v1/voicemail/greeting", { body }),
    /** Back to the default French/English greeting (every plan). */
    resetGreeting: () => request<VoicemailSettingsDto>("DELETE", "/v1/voicemail/greeting"),
    /** 202: Twilio rings the user's apps to record the greeting by phone. */
    recordGreetingByCall: () => request<RecordGreetingByCallResponse>("POST", "/v1/voicemail/greeting/call"),

    // Billing (Stripe Checkout on the web; the API decides the success/cancel URLs).
    /** Carries the pending affiliate link (lib/affiliate.ts) so the API records it before the payment. */
    checkout: (body: CheckoutRequest) => {
      const affiliate = body.affiliate ?? checkoutAffiliate();
      return request<CheckoutResponse>("POST", "/v1/billing/checkout", { body: affiliate ? { ...body, affiliate } : body });
    },
    /** Live picker hold (public: the token is the proof). */
    numberHold: (id: string, token: string) =>
      request<NumberHoldResponse>("GET", `/v1/public/numbers/holds/${seg(id)}`, { auth: false, headers: { "X-Hold-Token": token } }),
    billingPortal: () => request<BillingPortalResponse>("GET", "/v1/billing/portal"),

    // Missions MIMT (read-only: rewards are granted by the API when it sees the event, never claimed).
    missions: () => request<MissionsResponse>("GET", "/v1/missions"),
    /** My referral code and share link (the « Un ami s'abonne » mission). */
    referrals: () => request<ReferralsResponse>("GET", "/v1/referrals"),

    // Programme d'agents affiliés (docs/MIMT-AFFILIATES.md).
    /** 404 not_affiliate unless this user is an active (or suspended) affiliate. */
    affiliateDashboard: () => request<AffiliateDashboardResponse>("GET", "/v1/affiliates/me"),
    /** First touch of the link this browser arrived with; the API checks the window and self-referral. */
    affiliateAttribution: (code: string, touchedAt?: string) =>
      request<AffiliateAttributionResponse>("POST", "/v1/affiliates/attribution", { body: { code, ...(touchedAt ? { touchedAt } : {}) } }),
  };
}
