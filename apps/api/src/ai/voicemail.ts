import type { VoicemailInsight } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import type { Voicemail } from "../repo/types.js";
import { getFeatures } from "../services/accounts.js";
import { aiBudget, hasAiConsent, recordAiUsage } from "./service.js";

export type VoicemailAiResult =
  | "done"
  | "not_configured"
  | "no_transcript"
  | "not_entitled"
  | "no_consent"
  | "budget_exhausted"
  | "refusal"
  | "max_tokens"
  | "invalid_output";

/**
 * Voicemail intelligence: runs when a transcript arrives. Requires the vm_transcription entitlement and
 * the user's "ai_processing" consent; otherwise nothing is sent to the AI provider.
 */
export async function processVoicemailTranscript(deps: AppDeps, vm: Voicemail): Promise<VoicemailAiResult> {
  const { repo } = deps;
  const ai = deps.ai;
  if (!ai?.gateway) return "not_configured";
  const transcript = vm.transcript?.trim();
  if (!transcript) return "no_transcript";

  const account = await repo.getAccount(vm.telecomAccountId);
  const user = account ? await repo.getUser(account.ownerUserId) : null;
  if (!account || !user) return "not_entitled";
  const { features } = await getFeatures(repo, account.id);
  if (!features.has("vm_transcription")) return "not_entitled";
  if (!(await hasAiConsent(repo, user.id))) return "no_consent";
  if (!(await aiBudget(deps, ai, account.id)).available) return "budget_exhausted";

  const out = await ai.gateway.summarizeVoicemail({ transcript, locale: user.locale, callerNumber: vm.fromNumber });
  await recordAiUsage(deps, ai, account.id, "voicemail_summary", out.usage);
  if (!out.ok) {
    // Refusal or unusable output: keep the plain transcript, no AI fields, no AI notification text.
    return out.reason;
  }

  const insight: VoicemailInsight = {
    summary: out.value.summary.trim().slice(0, 500),
    locale: user.locale,
    callerIntent: out.value.callerIntent.trim().slice(0, 120),
    urgency: out.value.urgency,
    callbackSuggested: out.value.callbackSuggested,
    spamLikelihood: Math.min(1, Math.max(0, out.value.spamLikelihood)),
  };
  await ai.store.setVoicemailInsight(vm.id, insight, out.usage.model);

  const fr = user.locale === "fr-CA";
  await deps.notifier.notify(user.id, "voicemail_received", {
    voicemailId: vm.id,
    title: fr ? `Message vocal de ${vm.fromNumber ?? "numéro inconnu"}` : `Voicemail from ${vm.fromNumber ?? "unknown number"}`,
    text: insight.summary,
    urgency: insight.urgency,
    suspect: insight.spamLikelihood >= 0.7,
  });
  return "done";
}
