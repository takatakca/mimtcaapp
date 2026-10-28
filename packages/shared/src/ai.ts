// AI features (Claude). Source of truth for the API contract, budgets and limits: docs/MIMT-AI.md.
// Law 25: every feature that sends a user's personal data (voicemail transcript, SMS text) to the AI
// provider needs the separate, specific consent "ai_processing". The AI receptionist is covered by the
// business owner's acceptance of the receptionist terms (AI_RECEPTIONIST_TERMS_VERSION).

import type { Locale } from "./api.js";
import type { PlanCode } from "./plans.js";

/** Default Claude model. ANTHROPIC_MODEL overrides it on the server. */
export const AI_DEFAULT_MODEL = "claude-opus-5-5";

/** Consent kind (POST /v1/consents) required for voicemail summaries, smart replies and AI spam checks. */
export const AI_CONSENT_KIND = "ai_processing" as const;

/** Version of the AI receptionist terms a business owner accepts (PUT .../ai-receptionist with accept: true). */
export const AI_RECEPTIONIST_TERMS_VERSION = "2026-10-fr-draft-1";

export type AiFeature = "voicemail_summary" | "sms_suggestions" | "spam_classification" | "receptionist" | "help_assistant" | "call_summary" | "pilot_command";

/** POST /v1/ai/help — the in-app help assistant (answers about MIMT only, from a curated knowledge base). */
export interface HelpChatRequest {
  /** Oldest first, at most 12 turns; the last one is the user's question. */
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}
export interface HelpChatResponse {
  answer: string;
  /** True when the assistant could not answer and the user should write to a person (info@mimt.ca). */
  needsHuman: boolean;
}

// ------------------------------------------------------------------------------------------ voicemail

export type Urgency = "low" | "normal" | "high";

/** Structured voicemail summary, written in the user's language. */
export interface VoicemailInsight {
  /** One or two sentences, in `locale`. */
  summary: string;
  locale: Locale;
  /** Short label of why the person called ("prise de rendez-vous", "livraison"…), in `locale`. */
  callerIntent: string;
  urgency: Urgency;
  callbackSuggested: boolean;
  /** 0 to 1. */
  spamLikelihood: number;
}

// ------------------------------------------------------------------------------------------ spam

export type SpamVerdict = "spam" | "scam" | "ok";
/** What the apps display (« Spam probable » / “Likely spam”). "ok" is never sent. */
export type SpamLabel = Exclude<SpamVerdict, "ok">;

// ------------------------------------------------------------------------------------------ smart replies

/** GET /v1/conversations/:peer/suggestions. Suggestions are never sent automatically. */
export interface ReplySuggestionsResponse {
  /** Up to 3 short replies; empty when the model declined (reason set). */
  suggestions: string[];
  /** BCP 47-ish language of the suggestions ("fr-CA" by default). */
  language: string;
  reason?: "refused" | "unavailable";
}

// ------------------------------------------------------------------------------------------ receptionist

export interface AiTransferTarget {
  /** Stable key the model uses in transfer_call ("ventes", "soutien"…). */
  key: string;
  label: string;
  /** E.164 number to dial. */
  number?: string;
  /** PBX extension or ring group id (resolved by the PBX module when present). */
  extension?: string;
}

/** GET/PUT /v1/business/:id/ai-receptionist */
export interface AiReceptionistConfigDto {
  businessId: string;
  enabled: boolean;
  businessName: string;
  /** Optional extra greeting text, said after the mandatory AI disclosure. */
  greeting: string | null;
  faqMarkdown: string;
  hoursText: string;
  address: string | null;
  /** "fr-CA" first; "en-US"/"en-CA" offered as a second language. */
  languages: string[];
  transferTargets: AiTransferTarget[];
  /** When the business owner accepted the AI receptionist terms; null until accepted. */
  acceptedAt: string | null;
  acceptedVersion: string | null;
  updatedAt: string | null;
}

export interface AiReceptionistConfigRequest {
  enabled?: boolean;
  businessName?: string;
  greeting?: string | null;
  faqMarkdown?: string;
  hoursText?: string;
  address?: string | null;
  languages?: string[];
  transferTargets?: AiTransferTarget[];
  /** true = the owner accepts AI_RECEPTIONIST_TERMS_VERSION (AI disclosure, call transcripts sent to the AI provider). */
  accept?: boolean;
}

// ------------------------------------------------------------------------------------------ budget

/** GET /v1/ai/status */
export interface AiStatusResponse {
  configured: boolean;
  consent: boolean;
  plan: PlanCode;
  monthlyBudgetCadCents: number;
  usedCadCents: number;
  /** "YYYY-MM" (UTC). */
  period: string;
}

/**
 * Monthly AI spending cap per account, CAD cents (estimated from token usage). When it is reached, AI
 * features turn off until next month; calls, SMS and voicemail keep working.
 */
export const AI_MONTHLY_BUDGET_CAD_CENTS: Record<PlanCode, number> = {
  free: 0,
  lock: 0,
  premium: 200,
  business: 1000,
  business_pro: 2500,
};

/** List prices (USD per million tokens) of the default model, used for the budget estimate. */
export const AI_PRICING_USD_PER_MTOK = {
  input: 4,
  output: 20,
  cacheRead: 0.2,
  cacheWrite: 5,
} as const;

/** Hard limits that protect cost and callers. */
export const AI_LIMITS = {
  /** Receptionist session length. */
  receptionistMaxSeconds: 300,
  /** Output tokens per receptionist turn (thinking included). */
  receptionistMaxTokensPerTurn: 4000,
  /** Total output tokens per receptionist session. */
  receptionistMaxSessionOutputTokens: 30000,
  /** Model round trips per caller utterance (tool loops). */
  receptionistMaxStepsPerTurn: 4,
  /** Messages sent to the model for smart replies. */
  suggestionsContextMessages: 10,
  /** Characters of voicemail transcript sent to the model. */
  voicemailMaxChars: 6000,
  /** About 30 minutes of conversation. */
  callSummaryMaxChars: 30000,
} as const;
