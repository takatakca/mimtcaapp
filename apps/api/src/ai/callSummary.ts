import type { CallSummary } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import type { BusinessRow, RecordingRow } from "../repo/pbxTypes.js";
import { getFeatures } from "../services/accounts.js";
import { transcribeRecording, transcriptLanguage, usesIntelligence } from "../services/voicemailTranscription.js";
import { aiBudget, hasAiConsent, recordAiUsage } from "./service.js";
import { calendarSummarySaved } from "../services/calendar.js";

export type CallSummaryResult = "done" | "not_configured" | "not_entitled" | "no_consent" | "budget_exhausted" | "no_transcript" | "refusal" | "max_tokens" | "invalid_output";

/**
 * Affaires: transcribes a recorded business call (Conversation Intelligence, in the business language) and stores
 * an encrypted Claude summary with action items. Needs call recording + AI assist on the plan and the account
 * owner's "ai_processing" consent; otherwise nothing leaves MIMT. The Twilio recording follows its own retention.
 */
export async function summarizeBusinessCall(
  deps: AppDeps,
  business: BusinessRow,
  recording: RecordingRow,
  sleep?: (ms: number) => Promise<void>,
): Promise<CallSummaryResult> {
  const { repo } = deps;
  const ai = deps.ai;
  if (!ai?.gateway || !usesIntelligence(deps)) return "not_configured";
  const account = await repo.getAccount(business.telecomAccountId);
  if (!account) return "not_entitled";
  const { features } = await getFeatures(repo, account.id);
  if (!features.has("call_recording") || !features.has("ai_assist")) return "not_entitled";
  if (!(await hasAiConsent(repo, account.ownerUserId))) return "no_consent";
  if (!(await aiBudget(deps, ai, account.id)).available) return "budget_exhausted";

  const log = { warn: () => undefined, error: () => undefined };
  const t = await transcribeRecording(deps, { recordingSid: recording.recordingSid, language: transcriptLanguage(business.locale) }, log, sleep);
  const transcript = t.text?.trim();
  if (!transcript) return "no_transcript";

  const out = await ai.gateway.summarizeCall({ transcript, locale: business.locale });
  await recordAiUsage(deps, ai, account.id, "call_summary", out.usage);
  if (!out.ok) return out.reason;
  const summary: Omit<CallSummary, "locale"> = {
    text: out.value.summary.slice(0, 1000),
    actionItems: out.value.actionItems.map((a) => a.slice(0, 120)),
  };
  await repo.pbx.setCallSummary(recording.id, {
    summaryEncrypted: deps.cipher.encrypt(JSON.stringify(summary)),
    locale: business.locale,
    model: out.usage.model,
  });
  // « Google Agenda »: an event for the summary (content only with the user's opt-in). Never throws.
  await calendarSummarySaved(deps, undefined, recording, account.ownerUserId);
  return "done";
}

/** Decrypted summary for the recordings list, or null when there is none (or it cannot be read). */
export function callSummaryDto(deps: AppDeps, s: { summaryEncrypted: string; locale: "fr-CA" | "en-CA" } | undefined): CallSummary | null {
  if (!s) return null;
  try {
    const v = JSON.parse(deps.cipher.decrypt(s.summaryEncrypted)) as { text?: unknown; actionItems?: unknown };
    if (typeof v.text !== "string") return null;
    const items = Array.isArray(v.actionItems) ? v.actionItems.filter((a): a is string => typeof a === "string") : [];
    return { text: v.text, actionItems: items, locale: s.locale };
  } catch {
    return null;
  }
}
