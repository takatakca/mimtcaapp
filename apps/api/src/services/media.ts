import type { FastifyBaseLogger } from "fastify";
import {
  MEDIA_LIMITS,
  MEDIA_URL_TTL_S,
  MMS_RETENTION_DAYS,
  PENDING_UPLOAD_TTL_HOURS,
  type MediaPurpose,
  type MessageMediaDto,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { isTwilioMediaUrl } from "../gateways/twilio.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { extensionFor, normalizeContentType, sniffContentType } from "../lib/sniff.js";
import type { MediaKind, MediaObject } from "../repo/mediaTypes.js";
import type { Message } from "../repo/types.js";

const DAY_MS = 86_400_000;
/** Inbound MMS from Twilio: at most this many parts, each at most this big (Twilio's own limit is 5 MB total). */
export const INBOUND_MAX_PARTS = 10;
export const INBOUND_MAX_BYTES = 10 * 1024 * 1024;

export const mediaResource = (id: string) => `media:${id}`;
export const mmsExpiry = (now: Date) => new Date(now.getTime() + MMS_RETENTION_DAYS * DAY_MS);
export const pendingExpiry = (now: Date) => new Date(now.getTime() + PENDING_UPLOAD_TTL_HOURS * 3600_000);

const kindFor = (purpose: MediaPurpose): MediaKind => (purpose === "mms" ? "mms_out" : "greeting");

/** URL of GET /v1/media/:id with a capability token for this one object (players and Twilio send no headers). */
export async function signedMediaUrl(deps: AppDeps, id: string, ttlS = MEDIA_URL_TTL_S): Promise<{ url: string; expiresAt: Date }> {
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const signed = await deps.sessions.signMedia(mediaResource(id), ttlS);
  return { url: `${base}/v1/media/${id}?token=${encodeURIComponent(signed.token)}`, expiresAt: signed.expiresAt };
}

export async function mediaDto(deps: AppDeps, m: MediaObject): Promise<MessageMediaDto> {
  const available = Boolean(m.path || m.twilioUrl);
  const signed = available ? await signedMediaUrl(deps, m.id) : null;
  return { id: m.id, contentType: m.contentType, url: signed?.url ?? null, urlExpiresAt: signed?.expiresAt.toISOString() ?? null };
}

/** Attachments of each message, keyed by message id. */
export async function mediaByMessage(deps: AppDeps, messages: Message[]): Promise<Map<string, MessageMediaDto[]>> {
  const withMedia = messages.filter((m) => m.numMedia > 0).map((m) => m.id);
  const out = new Map<string, MessageMediaDto[]>();
  if (withMedia.length === 0) return out;
  for (const row of await deps.repo.media.listMediaForMessages(withMedia)) {
    const list = out.get(row.messageId!) ?? [];
    list.push(await mediaDto(deps, row));
    out.set(row.messageId!, list);
  }
  return out;
}

/**
 * Validates an upload request (purpose limits) and creates the pending row + signed upload URL.
 * Plan gating is done by the route.
 */
export async function createUpload(deps: AppDeps, accountId: string, purpose: MediaPurpose, declaredType: string, sizeBytes: number) {
  const limit = MEDIA_LIMITS[purpose];
  const contentType = normalizeContentType(declaredType);
  if (!limit.contentTypes.includes(contentType)) throw badRequest("unsupported_media_type", `Accepted: ${limit.contentTypes.join(", ")}`);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw badRequest("invalid_size");
  if (sizeBytes > limit.maxBytes) throw new HttpError(413, "media_too_large", `Max ${limit.maxBytes} bytes`);
  const store = deps.mediaFiles!;
  const now = deps.now();
  const row = await deps.repo.media.createMedia({
    telecomAccountId: accountId,
    kind: kindFor(purpose),
    status: "pending",
    path: null,
    twilioUrl: null,
    contentType,
    sizeBytes,
    messageId: null,
    expiresAt: pendingExpiry(now),
  });
  const path = `${purpose === "mms" ? "mms" : "greetings"}/${accountId}/${row.id}.${extensionFor(contentType)}`;
  await deps.repo.media.updateMedia(row.id, { path });
  const signed = await store.createSignedUpload!(path, contentType);
  return { media: { ...row, path }, signed, maxBytes: limit.maxBytes };
}

/**
 * Checks an uploaded file before it is used: it belongs to the account, has the right purpose, exists,
 * fits the limit and its bytes really are an accepted type. Marks it ready. Throws 400/404 otherwise.
 */
export async function claimUpload(deps: AppDeps, accountId: string, mediaId: string, purpose: MediaPurpose): Promise<MediaObject> {
  const row = await deps.repo.media.getMedia(mediaId);
  if (!row || row.telecomAccountId !== accountId || row.kind !== kindFor(purpose)) throw notFound("media_not_found");
  if (row.status !== "pending" || row.messageId || !row.path) throw badRequest("media_already_used");
  const stored = await deps.mediaFiles!.get(row.path);
  if (!stored) throw badRequest("media_not_uploaded", "Upload the file before using it");
  const limit = MEDIA_LIMITS[purpose];
  const sniffed = sniffContentType(stored.body);
  if (stored.body.length > limit.maxBytes || !sniffed || !limit.contentTypes.includes(sniffed)) {
    await deps.mediaFiles!.delete(row.path).catch(() => undefined);
    await deps.repo.media.deleteMedia(row.id);
    throw badRequest("invalid_media", "The file is too large or not an accepted type");
  }
  const updated = await deps.repo.media.updateMedia(row.id, {
    status: "ready",
    contentType: sniffed,
    sizeBytes: stored.body.length,
    expiresAt: purpose === "mms" ? mmsExpiry(deps.now()) : null,
  });
  return updated!;
}

/** Deletes the stored file (best effort) and the row. */
export async function removeMedia(deps: AppDeps, m: MediaObject, log?: Pick<FastifyBaseLogger, "warn">): Promise<void> {
  if (m.path && deps.mediaFiles) {
    await deps.mediaFiles.delete(m.path).catch((err: unknown) => log?.warn({ err, mediaId: m.id }, "media delete failed"));
  }
  if (m.twilioUrl && deps.twilio?.deleteMedia) {
    await deps.twilio.deleteMedia(m.twilioUrl).catch((err: unknown) => log?.warn({ err, mediaId: m.id }, "Twilio media delete failed"));
  }
  await deps.repo.media.deleteMedia(m.id);
}

/**
 * Inbound MMS: copies every part from Twilio (authenticated fetch) into the private bucket, records it,
 * then deletes it at Twilio. Received MMS is not plan-gated: free users receive pictures too.
 * If storage is not configured or the copy fails, the row keeps the Twilio URL and GET /v1/media/:id proxies it.
 */
export async function ingestInboundMedia(
  deps: AppDeps,
  log: Pick<FastifyBaseLogger, "warn" | "error">,
  message: Message,
  params: Record<string, string | undefined>,
): Promise<number> {
  const count = Math.min(Number(params.NumMedia ?? 0) || 0, INBOUND_MAX_PARTS);
  const now = deps.now();
  let stored = 0;
  for (let i = 0; i < count; i++) {
    const url = params[`MediaUrl${i}`];
    if (!isTwilioMediaUrl(url)) {
      log.warn({ messageId: message.id, part: i }, "inbound MMS part ignored: not a Twilio media URL");
      continue;
    }
    const declared = normalizeContentType(params[`MediaContentType${i}`]) || "application/octet-stream";
    const row = await deps.repo.media.createMedia({
      telecomAccountId: message.telecomAccountId,
      kind: "mms_in",
      status: "ready",
      path: null,
      twilioUrl: url,
      contentType: declared,
      sizeBytes: null,
      messageId: message.id,
      expiresAt: mmsExpiry(now),
    });
    stored++;
    if (!deps.mediaFiles || !deps.twilio?.fetchMedia) continue;
    try {
      const file = await deps.twilio.fetchMedia(url);
      if (file.body.length > INBOUND_MAX_BYTES) throw new Error("inbound media too large");
      const contentType = normalizeContentType(file.contentType) || declared;
      const path = `mms/${message.telecomAccountId}/${row.id}.${extensionFor(contentType)}`;
      await deps.mediaFiles.put(path, file.body, contentType);
      await deps.repo.media.updateMedia(row.id, { path, twilioUrl: null, contentType, sizeBytes: file.body.length });
      if (deps.twilio.deleteMedia) {
        await deps.twilio.deleteMedia(url).catch((err: unknown) => log.warn({ err, mediaId: row.id }, "Twilio media delete failed"));
      }
    } catch (err) {
      log.error({ err, mediaId: row.id }, "inbound MMS copy to private storage failed; serving from Twilio");
    }
  }
  return stored;
}

/** Retention job: deletes expired MMS media and never-used uploads (file, then row). */
export async function purgeExpiredMedia(deps: AppDeps, log: Pick<FastifyBaseLogger, "warn">, now = deps.now()): Promise<number> {
  let purged = 0;
  for (const m of await deps.repo.media.listExpiredMedia(now, 200)) {
    await removeMedia(deps, m, log);
    purged++;
  }
  return purged;
}
