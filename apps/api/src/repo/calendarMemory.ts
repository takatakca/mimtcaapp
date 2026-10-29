import { randomUUID } from "node:crypto";
import type {
  CalendarConnectionPatch,
  CalendarConnectionRow,
  CalendarJobStatus,
  CalendarRepository,
  CalendarSourceType,
  CalendarSyncJobRow,
} from "./calendar.js";

const copy = <T>(v: T): T => structuredClone(v);

/** Same rules as 0024_calendar.sql and PostgresCalendarRepository (single-threaded: every call is atomic). */
export class MemoryCalendarRepository implements CalendarRepository {
  readonly connections = new Map<string, CalendarConnectionRow>();
  readonly jobs: CalendarSyncJobRow[] = [];

  async upsertConnection(c: { userId: string; googleEmail: string | null; refreshTokenEncrypted: string; scope: string; at: Date }) {
    const old = this.connections.get(c.userId);
    const row: CalendarConnectionRow = old
      ? { ...old, googleEmail: c.googleEmail, refreshTokenEncrypted: c.refreshTokenEncrypted, scope: c.scope, status: "active", reconnectNotifiedAt: null, updatedAt: c.at }
      : {
          userId: c.userId,
          googleEmail: c.googleEmail,
          refreshTokenEncrypted: c.refreshTokenEncrypted,
          scope: c.scope,
          calendarId: "primary",
          status: "active",
          syncCalls: true,
          syncMissedCalls: true,
          syncVoicemails: true,
          syncSummaries: true,
          includeContent: false,
          reconnectNotifiedAt: null,
          lastSyncAt: null,
          connectedAt: c.at,
          updatedAt: c.at,
        };
    this.connections.set(c.userId, row);
    return copy(row);
  }

  async getConnection(userId: string) {
    const c = this.connections.get(userId);
    return c ? copy(c) : null;
  }

  async updateConnection(userId: string, patch: CalendarConnectionPatch) {
    const c = this.connections.get(userId);
    if (!c) return null;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (c as unknown as Record<string, unknown>)[k] = v;
    c.updatedAt = new Date();
    return copy(c);
  }

  async deleteConnection(userId: string) {
    const had = this.connections.delete(userId);
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i]!.userId === userId && this.jobs[i]!.status === "pending") this.jobs.splice(i, 1);
    return had;
  }

  async markNeedsReconnect(userId: string, at: Date) {
    const c = this.connections.get(userId);
    if (!c) return false;
    c.status = "needs_reconnect";
    c.updatedAt = at;
    if (c.reconnectNotifiedAt) return false;
    c.reconnectNotifiedAt = at;
    return true;
  }

  async enqueueJob(j: { userId: string; sourceType: CalendarSourceType; sourceId: string; notBefore: Date }) {
    if (this.jobs.some((x) => x.userId === j.userId && x.sourceType === j.sourceType && x.sourceId === j.sourceId)) return null;
    const row: CalendarSyncJobRow = {
      id: randomUUID(),
      userId: j.userId,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      status: "pending",
      attempts: 0,
      nextAttemptAt: j.notBefore,
      googleEventId: null,
      lastError: null,
      createdAt: new Date(),
      doneAt: null,
    };
    this.jobs.push(row);
    return copy(row);
  }

  async getJob(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    return j ? copy(j) : null;
  }

  async listDueJobs(now: Date, limit: number) {
    return this.jobs
      .filter((j) => j.status === "pending" && j.nextAttemptAt && j.nextAttemptAt.getTime() <= now.getTime())
      .sort((a, b) => a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async finishJob(id: string, r: { status: CalendarJobStatus; at: Date; googleEventId?: string | null; error?: string | null; nextAttemptAt?: Date | null; countAttempt?: boolean }) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.status = r.status;
    if (r.countAttempt !== false) j.attempts += 1;
    if (r.googleEventId) j.googleEventId = r.googleEventId;
    j.lastError = r.error ? r.error.slice(0, 300) : null;
    j.nextAttemptAt = r.status === "pending" ? (r.nextAttemptAt ?? r.at) : null;
    j.doneAt = r.status === "pending" ? null : r.at;
  }

  async purgeFinishedJobs(before: Date) {
    let n = 0;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i]!;
      if (j.status !== "pending" && j.doneAt && j.doneAt.getTime() < before.getTime()) {
        this.jobs.splice(i, 1);
        n++;
      }
    }
    return n;
  }

  /** Account purge (MemoryRepository.purgeUserData). */
  dropUser(userId: string) {
    this.connections.delete(userId);
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i]!.userId === userId) this.jobs.splice(i, 1);
  }
}
