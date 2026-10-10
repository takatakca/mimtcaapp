// Storage for MMS media, voicemail greetings/settings and the email outbox (migration 0007).

export type MediaKind = "mms_out" | "mms_in" | "greeting";
/** pending: upload URL issued, file not checked yet. ready: checked (or copied from Twilio). */
export type MediaStatus = "pending" | "ready";

export interface MediaObject {
  id: string;
  telecomAccountId: string;
  kind: MediaKind;
  status: MediaStatus;
  /** Object path in the private media bucket; null while the file is still only at Twilio. */
  path: string | null;
  /** Twilio media URL when the copy to our bucket has not happened (storage not configured or failed). */
  twilioUrl: string | null;
  contentType: string;
  sizeBytes: number | null;
  messageId: string | null;
  /** Retention: the file and row are deleted after this. Null = kept (active greeting). */
  expiresAt: Date | null;
  createdAt: Date;
}

export interface VoicemailSettings {
  telecomAccountId: string;
  greetingMediaId: string | null;
  emailEnabled: boolean;
  updatedAt: Date;
}

export interface EmailOutboxItem {
  id: string;
  userId: string;
  template: "voicemail_received";
  /** Rendered at send time (fresh transcript and link). voicemail_received: { voicemailId }. */
  payload: Record<string, unknown>;
  attempts: number;
  /** null once sent or dead-lettered. */
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface MediaRepository {
  createMedia(m: Omit<MediaObject, "id" | "createdAt">): Promise<MediaObject>;
  getMedia(id: string): Promise<MediaObject | null>;
  updateMedia(id: string, patch: Partial<Omit<MediaObject, "id" | "createdAt" | "telecomAccountId">>): Promise<MediaObject | null>;
  deleteMedia(id: string): Promise<void>;
  listMediaForMessages(messageIds: string[]): Promise<MediaObject[]>;
  /** Rows whose expiresAt is before `now` (oldest first). */
  listExpiredMedia(now: Date, limit: number): Promise<MediaObject[]>;

  getVoicemailSettings(accountId: string): Promise<VoicemailSettings | null>;
  upsertVoicemailSettings(accountId: string, patch: Partial<Pick<VoicemailSettings, "greetingMediaId" | "emailEnabled">>): Promise<VoicemailSettings>;

  enqueueEmail(e: { userId: string; template: EmailOutboxItem["template"]; payload: Record<string, unknown>; nextAttemptAt: Date }): Promise<EmailOutboxItem>;
  listDueEmails(now: Date, limit: number): Promise<EmailOutboxItem[]>;
  markEmailSent(id: string, at: Date): Promise<void>;
  markEmailFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
}
