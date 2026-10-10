// Pure helpers for MMS photos and greeting uploads (unit-tested in media.test.ts).
import { MEDIA_LIMITS, type MediaPurpose } from "@mimt/shared";
import type { MessageMediaDto } from "../api/types";
import type { TKey } from "../i18n";

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** The content type to declare for a picked/recorded file: its MIME type, else its extension. */
export function contentTypeFor(uri: string, mimeType?: string | null): string | null {
  const declared = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (declared) {
    if (declared === "image/jpg") return "image/jpeg";
    if (declared === "audio/x-wav" || declared === "audio/wave") return "audio/wav";
    return declared;
  }
  const ext = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri)?.[1]?.toLowerCase();
  return ext ? (BY_EXTENSION[ext] ?? null) : null;
}

/** Same limits as the API (MEDIA_LIMITS): returns the error message key, or null when the file can be sent. */
export function uploadProblem(purpose: MediaPurpose, contentType: string | null, sizeBytes: number | null | undefined): TKey | null {
  const limit = MEDIA_LIMITS[purpose];
  if (!contentType || !limit.contentTypes.includes(contentType)) return "error.mediaInvalid";
  if (sizeBytes != null && sizeBytes > limit.maxBytes) return "error.mediaTooLarge";
  return null;
}

/** Attachments the thread shows inline (images with a still-valid link). */
export function inlineImages(media: MessageMediaDto[] | undefined, now = Date.now()): MessageMediaDto[] {
  return (media ?? []).filter(
    (m) => m.contentType.startsWith("image/") && m.url !== null && (!m.urlExpiresAt || Date.parse(m.urlExpiresAt) > now),
  );
}
