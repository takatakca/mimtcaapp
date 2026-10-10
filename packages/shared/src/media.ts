// MMS media and voicemail greeting/email contract (docs/MIMT-PARITY.md P0-4 and P1-4).
// Files live in a private Supabase Storage bucket; the app uploads with a signed URL and reads through
// short-lived signed API URLs. No storage or Twilio credentials ever reach the client.

/** What an upload is for. "mms" needs the "mms" feature; "greeting" needs "vm_greeting". */
export type MediaPurpose = "mms" | "greeting";

export interface MediaLimit {
  /** Largest accepted file, in bytes. */
  maxBytes: number;
  /** Accepted content types (checked against the declared type AND the file's magic bytes). */
  contentTypes: readonly string[];
}

/**
 * Upload limits. MMS: Twilio accepts up to 5 MB per message and only reformats JPEG/PNG/GIF for phones.
 * Greeting: formats Twilio <Play> supports (MP3, WAV), at most 60 s of speech.
 */
export const MEDIA_LIMITS: Record<MediaPurpose, MediaLimit> = {
  mms: { maxBytes: 5 * 1024 * 1024, contentTypes: ["image/jpeg", "image/png", "image/gif"] },
  greeting: { maxBytes: 5 * 1024 * 1024, contentTypes: ["audio/mpeg", "audio/wav"] },
};

/** Total media in one outbound MMS (Twilio limit). */
export const MMS_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** Attachments per outbound message (Twilio allows 10; the app sends a few photos at most). */
export const MMS_MAX_ATTACHMENTS = 5;
/** Days MMS media (sent and received) is kept before it is deleted from storage. */
export const MMS_RETENTION_DAYS = 180;
/** Uploads never attached to a message or a greeting are deleted after this many hours. */
export const PENDING_UPLOAD_TTL_HOURS = 24;
/** Lifetime of the signed media URLs returned in MessageDto.media and greeting previews. */
export const MEDIA_URL_TTL_S = 15 * 60;
/** Lifetime of the audio link in a voicemail email. */
export const VOICEMAIL_EMAIL_LINK_TTL_S = 7 * 24 * 3600;
/** Longest custom greeting (seconds). */
export const GREETING_MAX_S = 60;

/** POST /v1/media/uploads */
export interface CreateMediaUploadRequest {
  purpose: MediaPurpose;
  /** Declared type, one of MEDIA_LIMITS[purpose].contentTypes ("audio/x-wav" and "audio/wave" count as "audio/wav"). */
  contentType: string;
  sizeBytes: number;
}

/**
 * 201. PUT the file bytes to uploadUrl with uploadHeaders before uploadExpiresAt, then reference mediaId
 * (POST /v1/messages mediaIds, or PUT /v1/voicemail/greeting). The API re-checks size and type then.
 */
export interface CreateMediaUploadResponse {
  mediaId: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  uploadExpiresAt: string;
  maxBytes: number;
}

/** One attachment of a message, readable without a bearer token until urlExpiresAt. */
export interface MessageMediaDto {
  id: string;
  contentType: string;
  /** Null when the file is gone (retention) or could not be copied. */
  url: string | null;
  urlExpiresAt: string | null;
}

/** GET /v1/voicemail/settings */
export interface VoicemailSettingsDto {
  /** What the plan allows. The app shows an upgrade hint when false. */
  available: { greeting: boolean; email: boolean };
  /** Custom greeting, null when the default French/English greeting plays. */
  greeting: { mediaId: string; url: string | null; urlExpiresAt: string | null; updatedAt: string } | null;
  emailEnabled: boolean;
  /** Address voicemails are sent to (the account email). Null when the account has none. */
  email: string | null;
}

/** PATCH /v1/voicemail/settings → VoicemailSettingsDto. 403 vm_email_not_in_plan, 409 no_email. */
export interface UpdateVoicemailSettingsRequest {
  emailEnabled?: boolean;
}

/** PUT /v1/voicemail/greeting → VoicemailSettingsDto. DELETE /v1/voicemail/greeting → default greeting. */
export interface SetGreetingRequest {
  mediaId: string;
}

/** POST /v1/voicemail/greeting/call → 202: Twilio calls the user's app to record the greeting by phone. */
export interface RecordGreetingByCallResponse {
  status: "calling";
}
