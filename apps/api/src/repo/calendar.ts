// « Google Agenda » storage (supabase/migrations/0024_calendar.sql). Service and rules: src/services/calendar.ts.
// Memory and Postgres implementations behave the same (calendar.repo.contract.test.ts).

export type CalendarSourceType = "call" | "voicemail" | "call_summary";
export type CalendarJobStatus = "pending" | "sent" | "skipped" | "failed";

export interface CalendarConnectionRow {
  userId: string;
  googleEmail: string | null;
  /** MessageCipher ciphertext ("v1.…"); never logged, never returned by the API. */
  refreshTokenEncrypted: string;
  scope: string;
  calendarId: "primary";
  status: "active" | "needs_reconnect";
  syncCalls: boolean;
  syncMissedCalls: boolean;
  syncVoicemails: boolean;
  syncSummaries: boolean;
  includeContent: boolean;
  reconnectNotifiedAt: Date | null;
  lastSyncAt: Date | null;
  connectedAt: Date;
  updatedAt: Date;
}

export type CalendarSettingsPatch = Partial<Pick<CalendarConnectionRow, "syncCalls" | "syncMissedCalls" | "syncVoicemails" | "syncSummaries" | "includeContent">>;
export type CalendarConnectionPatch = CalendarSettingsPatch &
  Partial<Pick<CalendarConnectionRow, "status" | "reconnectNotifiedAt" | "lastSyncAt">>;

export interface CalendarSyncJobRow {
  id: string;
  userId: string;
  sourceType: CalendarSourceType;
  sourceId: string;
  status: CalendarJobStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  googleEventId: string | null;
  lastError: string | null;
  createdAt: Date;
  doneAt: Date | null;
}

export interface CalendarRepository {
  /**
   * Connects (or reconnects) the user's Google account: a new refresh token, status active, the reconnect notice
   * cleared. Settings are kept on a reconnect.
   */
  upsertConnection(c: { userId: string; googleEmail: string | null; refreshTokenEncrypted: string; scope: string; at: Date }): Promise<CalendarConnectionRow>;
  getConnection(userId: string): Promise<CalendarConnectionRow | null>;
  updateConnection(userId: string, patch: CalendarConnectionPatch): Promise<CalendarConnectionRow | null>;
  /** Deletes the connection and the user's pending jobs. True when there was one. */
  deleteConnection(userId: string): Promise<boolean>;
  /**
   * Marks the connection needs_reconnect. Returns true only the first time since it was last active (the caller
   * then notifies the user once).
   */
  markNeedsReconnect(userId: string, at: Date): Promise<boolean>;

  /** Queues once per (user, source type, source id): null when that job already exists (whatever its status). */
  enqueueJob(j: { userId: string; sourceType: CalendarSourceType; sourceId: string; notBefore: Date }): Promise<CalendarSyncJobRow | null>;
  getJob(id: string): Promise<CalendarSyncJobRow | null>;
  /** Pending jobs due at `now`, oldest due first. */
  listDueJobs(now: Date, limit: number): Promise<CalendarSyncJobRow[]>;
  /** status sent | skipped | failed: done. pending: retry at nextAttemptAt (attempts + 1). */
  finishJob(id: string, r: { status: CalendarJobStatus; at: Date; googleEventId?: string | null; error?: string | null; nextAttemptAt?: Date | null; countAttempt?: boolean }): Promise<void>;
  /** Removes finished jobs (sent, skipped, failed) done before `before`. Returns how many. */
  purgeFinishedJobs(before: Date): Promise<number>;
}
