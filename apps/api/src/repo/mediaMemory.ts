import { randomUUID } from "node:crypto";
import type { EmailOutboxItem, MediaObject, MediaRepository, VoicemailSettings } from "./mediaTypes.js";

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryMediaRepository implements MediaRepository {
  media = new Map<string, MediaObject>();
  settings = new Map<string, VoicemailSettings>();
  emails: EmailOutboxItem[] = [];

  async createMedia(m: Omit<MediaObject, "id" | "createdAt">) {
    const row: MediaObject = { ...m, id: randomUUID(), createdAt: new Date() };
    this.media.set(row.id, row);
    return clone(row);
  }
  async getMedia(id: string) {
    const m = this.media.get(id);
    return m ? clone(m) : null;
  }
  async updateMedia(id: string, patch: Partial<Omit<MediaObject, "id" | "createdAt" | "telecomAccountId">>) {
    const m = this.media.get(id);
    if (!m) return null;
    Object.assign(m, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return clone(m);
  }
  async deleteMedia(id: string) {
    this.media.delete(id);
    for (const s of this.settings.values()) if (s.greetingMediaId === id) s.greetingMediaId = null;
  }
  async listMediaForMessages(messageIds: string[]) {
    const ids = new Set(messageIds);
    return [...this.media.values()]
      .filter((m) => m.messageId && ids.has(m.messageId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async listExpiredMedia(now: Date, limit: number) {
    return [...this.media.values()]
      .filter((m) => m.expiresAt && m.expiresAt < now)
      .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async getVoicemailSettings(accountId: string) {
    const s = this.settings.get(accountId);
    return s ? clone(s) : null;
  }
  async upsertVoicemailSettings(accountId: string, patch: Partial<Pick<VoicemailSettings, "greetingMediaId" | "emailEnabled">>) {
    const current = this.settings.get(accountId) ?? { telecomAccountId: accountId, greetingMediaId: null, emailEnabled: false, updatedAt: new Date() };
    const next: VoicemailSettings = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      updatedAt: new Date(),
    };
    this.settings.set(accountId, next);
    return clone(next);
  }

  async enqueueEmail(e: { userId: string; template: EmailOutboxItem["template"]; payload: Record<string, unknown>; nextAttemptAt: Date }) {
    const row: EmailOutboxItem = { ...e, id: randomUUID(), attempts: 0, sentAt: null, lastError: null, createdAt: new Date() };
    this.emails.push(row);
    return clone(row);
  }
  async listDueEmails(now: Date, limit: number) {
    return this.emails
      .filter((e) => !e.sentAt && e.nextAttemptAt && e.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime())
      .slice(0, limit)
      .map(clone);
  }
  async markEmailSent(id: string, at: Date) {
    const e = this.emails.find((x) => x.id === id);
    if (e) Object.assign(e, { sentAt: at, nextAttemptAt: null });
  }
  async markEmailFailed(id: string, error: string, nextAttemptAt: Date | null) {
    const e = this.emails.find((x) => x.id === id);
    if (e) Object.assign(e, { attempts: e.attempts + 1, lastError: error.slice(0, 500), nextAttemptAt });
  }
}
