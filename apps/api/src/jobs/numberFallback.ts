import type { Config } from "../config.js";
import { numberFallbacks, type TwilioGateway } from "../gateways/twilio.js";
import type { PhoneNumber, Repository } from "../repo/types.js";

/**
 * Owner rule: Twilio numbers created before this date are never modified, whatever the configuration says.
 * Fixed in code on purpose (no env override), like the « ne jamais toucher aux numéros déjà chez Twilio » rule
 * of the number lifecycle (NUMBER_LIFECYCLE_FROM).
 */
export const FALLBACK_BACKFILL_FROM = new Date("2026-10-23T00:00:00Z");

/** States whose number is still on our Twilio account and answered by our webhooks. */
const ON_TWILIO: PhoneNumber["state"][] = ["active", "locked", "grace", "quarantine"];

export interface FallbackBackfillResult {
  updated: number;
  /** Already carried the configured fallback(s): nothing to do (the job is idempotent). */
  unchanged: number;
  /** Older than the owner cut-off (in our table or at Twilio), no Twilio SID, or a Twilio record that does not match. */
  skipped: number;
  errors: number;
}

/**
 * Applies TWILIO_VOICE_FALLBACK_URL / TWILIO_SMS_FALLBACK_URL to the numbers MIMT itself provisioned.
 *
 * Only numbers in our phone_numbers table are considered, never a listing of the Twilio account. Each must be
 * created on or after FALLBACK_BACKFILL_FROM in our table AND at Twilio (dateCreated), and the Twilio record must
 * carry the same E.164. Only the fallback fields are written; voice/SMS URLs, 9-1-1 address and the rest stay.
 * A fallback that is not configured is left as it is (never cleared). Safe to run at every start.
 */
export async function runFallbackBackfill(input: {
  repo: Repository;
  twilio: TwilioGateway | null;
  config: Pick<Config, "TWILIO_VOICE_FALLBACK_URL" | "TWILIO_SMS_FALLBACK_URL">;
  log?: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}): Promise<FallbackBackfillResult> {
  const result: FallbackBackfillResult = { updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  const wanted = numberFallbacks(input.config);
  const { twilio } = input;
  if ((!wanted.voiceFallbackUrl && !wanted.smsFallbackUrl) || !twilio?.fetchNumberConfig || !twilio.updateNumberFallbacks) return result;

  for (const n of await input.repo.listNumbersInStates(ON_TWILIO)) {
    if (!n.twilioSid || n.createdAt < FALLBACK_BACKFILL_FROM) {
      result.skipped++;
      continue;
    }
    try {
      const at = await twilio.fetchNumberConfig(n.twilioSid);
      // Second guard on Twilio's own creation date: a number that existed at Twilio before the cut-off is never
      // touched, even if our row is newer (re-assigned, re-imported). Unknown date = not touched.
      if (!at.dateCreated || at.dateCreated < FALLBACK_BACKFILL_FROM || at.e164 !== n.e164) {
        result.skipped++;
        continue;
      }
      const missing = {
        ...(wanted.voiceFallbackUrl && at.voiceFallbackUrl !== wanted.voiceFallbackUrl ? { voiceFallbackUrl: wanted.voiceFallbackUrl } : {}),
        ...(wanted.smsFallbackUrl && at.smsFallbackUrl !== wanted.smsFallbackUrl ? { smsFallbackUrl: wanted.smsFallbackUrl } : {}),
      };
      if (!missing.voiceFallbackUrl && !missing.smsFallbackUrl) {
        result.unchanged++;
        continue;
      }
      await twilio.updateNumberFallbacks(n.twilioSid, missing);
      await input.repo.audit({ actorUserId: null, action: "number.fallback_set", targetType: "phone_number", targetId: n.id, meta: { voice: Boolean(missing.voiceFallbackUrl), sms: Boolean(missing.smsFallbackUrl) } });
      result.updated++;
    } catch (err) {
      result.errors++;
      input.log?.error({ err: err instanceof Error ? err.message : "error", numberId: n.id }, "number fallback step failed");
    }
  }
  input.log?.info({ ...result }, "number fallback backfill done");
  return result;
}
