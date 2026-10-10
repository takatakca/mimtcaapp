// AI (Claude) and MIMT Affaires endpoints for the mobile app. Pure: built on an injected request
// function so they can be unit-tested without React Native (see ai.test.ts). The live instances bound
// to the real client are in features.ts. Contract: packages/shared/src/ai.ts, docs/MIMT-AI.md.
import {
  AI_CONSENT_KIND,
  type AiStatusResponse,
  type BusinessesResponse,
  type ClaimInvitesResponse,
  type ConsentResponse,
  type ExtensionsResponse,
  type ReplySuggestionsResponse,
  type SpamLabel,
  type VoicemailDto,
} from "@mimt/shared";
import type { TKey } from "../i18n/core";
import { ApiClientError, toErrorKey } from "./errors";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Requester = <T>(
  method: Method,
  path: string,
  opts?: { body?: unknown; query?: Record<string, string | undefined> },
) => Promise<T>;

/** Version of the Law 25 AI consent text shown in settings (app/settings/ai.tsx). Bump when the text changes. */
export const AI_CONSENT_VERSION = "2026-10-ai-1";

export function makeAiApi(request: Requester) {
  return {
    /** Configured? consent? monthly budget. Never sends data to the AI provider. */
    status: () => request<AiStatusResponse>("GET", "/v1/ai/status"),
    /** Law 25: separate, specific consent for AI processing of voicemails and texts. Withdrawal is immediate. */
    setConsent: (granted: boolean) =>
      request<ConsentResponse>("POST", "/v1/consents", {
        body: { kind: AI_CONSENT_KIND, granted, version: AI_CONSENT_VERSION, source: "mobile" },
      }),
    /** On-demand voicemail summary; returns the voicemail with `ai` filled in. */
    summarizeVoicemail: (id: string) => request<VoicemailDto>("POST", `/v1/voicemails/${encodeURIComponent(id)}/summary`),
    /** Up to 3 smart replies for a thread. Never sent automatically: the user picks and edits. */
    suggestions: (peer: string) =>
      request<ReplySuggestionsResponse>("GET", `/v1/conversations/${encodeURIComponent(peer)}/suggestions`),
  };
}

export function makeBusinessApi(request: Requester) {
  return {
    /** Businesses I belong to (owner, admin or member). */
    list: () => request<BusinessesResponse>("GET", "/v1/business"),
    /** Every member can list extensions; the app keeps only the caller's own. */
    extensions: (businessId: string) =>
      request<ExtensionsResponse>("GET", `/v1/business/${encodeURIComponent(businessId)}/extensions`),
    /** Claims pending invitations sent to my email address. */
    claimInvites: () => request<ClaimInvitesResponse>("POST", "/v1/business/invites/claim"),
  };
}

// ------------------------------------------------------------------------------------- errors

/** AI-specific error codes → messages (docs/MIMT-AI.md §2). Anything else uses the generic mapping. */
const AI_CODE_TO_KEY: Record<string, TKey> = {
  not_configured: "ai.error.notConfigured",
  ai_consent_required: "ai.error.consentRequired",
  ai_budget_exhausted: "ai.error.budgetExhausted",
  ai_unavailable: "ai.error.unavailable",
  no_transcript: "ai.error.noTranscript",
  plan_required: "ai.error.planRequired",
};

export function aiErrorKey(e: unknown): TKey {
  if (e instanceof ApiClientError) {
    if (e.code && AI_CODE_TO_KEY[e.code]) return AI_CODE_TO_KEY[e.code]!;
    if (e.status === 503) return "ai.error.notConfigured";
  }
  return toErrorKey(e);
}

/** What the screen should do after an AI call failed. */
export type AiFailure = "hide" | "needs_consent" | "message";

export function aiFailure(e: unknown): AiFailure {
  if (!(e instanceof ApiClientError)) return "message";
  if (e.code === "not_configured" || e.status === 503) return "hide";
  if (e.code === "ai_consent_required") return "needs_consent";
  return "message";
}

// ------------------------------------------------------------------------------------- UI state

export interface AiUi {
  /** Show any AI control at all (false when the server has no AI key). */
  visible: boolean;
  /** AI controls can be used right now (consent given and budget left). */
  usable: boolean;
  needsConsent: boolean;
  /** The plan has an AI budget at all (free and lock plans have none). */
  planHasAi: boolean;
  budgetExhausted: boolean;
}

/** Decides what AI UI to show from GET /v1/ai/status (null = not loaded yet or failed: hide). */
export function aiUi(status: AiStatusResponse | null | undefined): AiUi {
  if (!status?.configured) return { visible: false, usable: false, needsConsent: false, planHasAi: false, budgetExhausted: false };
  const planHasAi = status.monthlyBudgetCadCents > 0;
  const budgetExhausted = planHasAi && status.usedCadCents >= status.monthlyBudgetCadCents;
  return {
    visible: planHasAi,
    usable: planHasAi && status.consent && !budgetExhausted,
    needsConsent: planHasAi && !status.consent,
    planHasAi,
    budgetExhausted,
  };
}

// ------------------------------------------------------------------------------------- spam

export function spamKey(label: SpamLabel | null | undefined): TKey | null {
  if (label === "spam") return "ai.spam.spam";
  if (label === "scam") return "ai.spam.scam";
  return null;
}

/** Voicemail summaries carry a 0-1 likelihood; above this the app shows the spam label. */
export const VOICEMAIL_SPAM_THRESHOLD = 0.7;
