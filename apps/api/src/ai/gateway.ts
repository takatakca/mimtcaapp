import type Anthropic from "@anthropic-ai/sdk";
import type { Direction, Locale, SpamVerdict, Urgency } from "@mimt/shared";

/**
 * Every Claude call goes through this interface so tests can replace it (no real API calls in tests).
 * The production implementation is ClaudeGateway (claude.ts).
 */
export interface AiGateway {
  /** Structured voicemail summary in `locale` (effort "medium"). */
  summarizeVoicemail(input: VoicemailSummaryInput): Promise<AiOutcome<VoicemailSummary>>;
  summarizeCall(input: CallSummaryInput): Promise<AiOutcome<CallSummaryOutput>>;
  /** Three short reply suggestions (effort "low"). */
  suggestReplies(input: SuggestRepliesInput): Promise<AiOutcome<ReplySuggestions>>;
  /** Spam/scam/ok label for an ambiguous inbound SMS (effort "low"). */
  classifySms(input: ClassifySmsInput): Promise<AiOutcome<SmsClassification>>;
  /** In-app help assistant: answers from the MIMT knowledge base only (effort "low"). */
  helpAnswer(input: HelpAnswerInput): Promise<AiOutcome<HelpAnswer>>;
  /** One streamed model round trip of the AI receptionist (effort "medium"). Text deltas go to onText. */
  receptionistStep(input: ReceptionistStepInput, onText: (delta: string) => void): Promise<ReceptionistStepResult>;
}

export interface TokenUsage {
  /** Model that produced the answer (a server-side fallback model can differ from the requested one). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AiFailure = "refusal" | "max_tokens" | "invalid_output";

export type AiOutcome<T> =
  | { ok: true; value: T; usage: TokenUsage }
  | { ok: false; reason: AiFailure; usage: TokenUsage; refusalCategory?: string | null };

export interface HelpAnswerInput {
  locale: Locale;
  /** MIMT facts (ai/helpKnowledge.ts). */
  knowledge: string;
  /** Oldest first; the last turn is the user's question. */
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface HelpAnswer {
  answer: string;
  needsHuman: boolean;
}

export interface VoicemailSummaryInput {
  transcript: string;
  locale: Locale;
  callerNumber: string | null;
}

export interface CallSummaryInput {
  transcript: string;
  locale: Locale;
}

export interface CallSummaryOutput {
  summary: string;
  actionItems: string[];
}

export interface VoicemailSummary {
  summary: string;
  callerIntent: string;
  urgency: Urgency;
  callbackSuggested: boolean;
  spamLikelihood: number;
}

export interface SuggestRepliesInput {
  /** The user's locale; used when the conversation language is unclear. */
  locale: Locale;
  /** Oldest first. "inbound" = the other person, "outbound" = the user. */
  messages: Array<{ direction: Direction; text: string }>;
}

export interface ReplySuggestions {
  language: string;
  suggestions: string[];
}

export interface ClassifySmsInput {
  text: string;
  /** The user has written to this sender before. */
  knownSender: boolean;
}

export interface SmsClassification {
  verdict: SpamVerdict;
  reason: string;
}

export interface ReceptionistStepInput {
  /** Per-business context (name, hours, FAQ, transfer targets). Stable for the whole call. */
  businessContext: string;
  /** Full conversation so far, append-only (assistant turns are echoed back verbatim). */
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ReceptionistStepResult {
  stopReason: string | null;
  refusalCategory?: string | null;
  /** The assistant content blocks, to append to `messages` as they are. */
  content: Anthropic.Beta.Messages.BetaContentBlock[];
  usage: TokenUsage;
}

export const emptyUsage = (model: string): TokenUsage => ({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
