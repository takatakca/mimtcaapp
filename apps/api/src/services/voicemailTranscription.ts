import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../deps.js";
import type { TranscriptLanguage } from "../gateways/twilio.js";
import { processVoicemailTranscript } from "../ai/voicemail.js";

/** Conversation Intelligence usually finishes a short voicemail in under a minute. */
const POLL_EVERY_MS = 15_000;
const GIVE_UP_AFTER_MS = 20 * 60_000;

/** True when voicemails are transcribed by Conversation Intelligence (French or English) instead of Twilio's English-only engine. */
export function usesIntelligence(deps: AppDeps): boolean {
  return deps.config.VOICEMAIL_TRANSCRIPTION === "intelligence" && Boolean(deps.twilio?.intelligence);
}

export function transcriptLanguage(locale: string | null | undefined): TranscriptLanguage {
  return locale?.toLowerCase().startsWith("en") ? "en" : "fr";
}

/**
 * Transcribes one voicemail, stores the text, then deletes the transcript and the Twilio recording (the audio is
 * already in private storage). The recording is deleted even when transcription fails or times out.
 */
export async function transcribeVoicemail(
  deps: AppDeps,
  input: { recordingSid: string; language: TranscriptLanguage; deleteRecording: () => Promise<void> },
  log: Pick<FastifyBaseLogger, "warn" | "error">,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<"completed" | "failed" | "timeout"> {
  const transcriber = deps.twilio?.intelligence;
  if (!transcriber) return "failed";
  let transcriptSid: string | null = null;
  let outcome: "completed" | "failed" | "timeout" = "timeout";
  try {
    transcriptSid = await transcriber.start({ language: input.language, recordingSid: input.recordingSid, customerKey: input.recordingSid });
    for (let waited = 0; waited < GIVE_UP_AFTER_MS; waited += POLL_EVERY_MS) {
      await sleep(POLL_EVERY_MS);
      const r = await transcriber.result(transcriptSid);
      if (r.status === "pending") continue;
      outcome = r.status;
      if (r.status === "completed") {
        const vm = await deps.repo.updateVoicemailByRecordingSid(input.recordingSid, { transcript: r.text, transcriptLang: input.language });
        if (vm?.transcript && deps.ai?.gateway) deps.ai.background("voicemail:summary", () => processVoicemailTranscript(deps, vm));
      }
      break;
    }
  } catch (err) {
    outcome = "failed";
    log.error({ err, recordingSid: input.recordingSid }, "voicemail transcription failed");
  }
  if (transcriptSid) await transcriber.remove(transcriptSid).catch((err: unknown) => log.warn({ err }, "transcript delete failed"));
  await input.deleteRecording().catch((err: unknown) => log.warn({ err }, "recording delete failed"));
  return outcome;
}
