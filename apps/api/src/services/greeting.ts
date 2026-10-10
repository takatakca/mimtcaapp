import type { FastifyBaseLogger } from "fastify";
import type { Feature } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import type { MediaObject } from "../repo/mediaTypes.js";
import { removeMedia, signedMediaUrl } from "./media.js";

/** Twilio fetches the greeting while the caller waits; the link only has to live through the call setup. */
export const GREETING_PLAY_TTL_S = 10 * 60;

/**
 * URL for <Play> in the voicemail TwiML, or null to use the default bilingual greeting.
 * Null when the plan lost vm_greeting, no greeting is set, or anything fails: voicemail must always answer.
 */
export async function greetingPlayUrl(deps: AppDeps, accountId: string, features: Set<Feature>, log?: Pick<FastifyBaseLogger, "warn">): Promise<string | null> {
  try {
    if (!features.has("vm_greeting") || !deps.mediaFiles) return null;
    const settings = await deps.repo.media.getVoicemailSettings(accountId);
    if (!settings?.greetingMediaId) return null;
    const media = await deps.repo.media.getMedia(settings.greetingMediaId);
    if (!media || media.telecomAccountId !== accountId || media.kind !== "greeting" || media.status !== "ready" || !media.path) return null;
    return (await signedMediaUrl(deps, media.id, GREETING_PLAY_TTL_S)).url;
  } catch (err) {
    log?.warn({ err, accountId }, "custom greeting lookup failed; using the default greeting");
    return null;
  }
}

/** Makes `media` the active greeting and deletes the previous one. */
export async function activateGreeting(deps: AppDeps, accountId: string, media: MediaObject, log?: Pick<FastifyBaseLogger, "warn">): Promise<void> {
  const previous = await deps.repo.media.getVoicemailSettings(accountId);
  await deps.repo.media.updateMedia(media.id, { status: "ready", expiresAt: null });
  await deps.repo.media.upsertVoicemailSettings(accountId, { greetingMediaId: media.id });
  if (previous?.greetingMediaId && previous.greetingMediaId !== media.id) {
    const old = await deps.repo.media.getMedia(previous.greetingMediaId);
    if (old) await removeMedia(deps, old, log);
  }
}

/** Back to the default greeting. */
export async function clearGreeting(deps: AppDeps, accountId: string, log?: Pick<FastifyBaseLogger, "warn">): Promise<void> {
  const settings = await deps.repo.media.getVoicemailSettings(accountId);
  await deps.repo.media.upsertVoicemailSettings(accountId, { greetingMediaId: null });
  if (settings?.greetingMediaId) {
    const old = await deps.repo.media.getMedia(settings.greetingMediaId);
    if (old) await removeMedia(deps, old, log);
  }
}
