import { randomUUID } from "node:crypto";
import type { AuthSessionRow, NewAuthSession, PasskeyRow, SecurityRepository } from "./security.js";

export class MemorySecurityRepository implements SecurityRepository {
  readonly sessions = new Map<string, AuthSessionRow>();
  readonly passkeys = new Map<string, PasskeyRow>();
  readonly policies = new Map<string, boolean>();

  async createSession(s: NewAuthSession) {
    const existing = this.sessions.get(s.id);
    if (existing) return { ...existing };
    const row: AuthSessionRow = {
      id: s.id,
      userId: s.userId,
      method: s.method,
      userAgent: s.userAgent,
      ipPrefix: s.ipPrefix,
      createdAt: s.at,
      lastSeenAt: s.at,
      recentAuthAt: s.recentAuthAt,
      strongAuthAt: s.strongAuthAt,
      revokedAt: null,
    };
    this.sessions.set(row.id, row);
    return { ...row };
  }
  async getSession(id: string) {
    const r = this.sessions.get(id);
    return r ? { ...r } : null;
  }
  async listActiveSessions(userId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && !s.revokedAt)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map((s) => ({ ...s }));
  }
  async deviceHistory(userId: string, userAgent: string) {
    const mine = [...this.sessions.values()].filter((s) => s.userId === userId);
    return { anySession: mine.length > 0, sameDevice: mine.some((s) => s.userAgent === userAgent) };
  }
  async touchSession(id: string, at: Date) {
    const r = this.sessions.get(id);
    if (r && at > r.lastSeenAt) r.lastSeenAt = at;
  }
  async markAuth(id: string, at: Date, strong: boolean) {
    const r = this.sessions.get(id);
    if (!r) return;
    r.recentAuthAt = at;
    if (strong) r.strongAuthAt = at;
  }
  async revokeSession(id: string, at: Date) {
    const r = this.sessions.get(id);
    if (!r || r.revokedAt) return false;
    r.revokedAt = at;
    return true;
  }
  async revokeOtherSessions(userId: string, keepId: string | null, at: Date) {
    const ids: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.userId !== userId || s.revokedAt || s.id === keepId) continue;
      s.revokedAt = at;
      ids.push(s.id);
    }
    return ids;
  }
  async pruneSessions(before: Date) {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if ((s.revokedAt && s.revokedAt < before) || s.lastSeenAt < before) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }

  async addPasskey(p: Omit<PasskeyRow, "id" | "createdAt" | "lastUsedAt"> & { createdAt: Date }) {
    if ([...this.passkeys.values()].some((k) => k.credentialId === p.credentialId)) throw new Error("duplicate credential");
    const row: PasskeyRow = { ...p, id: randomUUID(), lastUsedAt: null };
    this.passkeys.set(row.id, row);
    return { ...row };
  }
  async listPasskeys(userId: string) {
    return [...this.passkeys.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((k) => ({ ...k }));
  }
  async findPasskeyByCredentialId(credentialId: string) {
    const r = [...this.passkeys.values()].find((k) => k.credentialId === credentialId);
    return r ? { ...r } : null;
  }
  async updatePasskeyUse(id: string, counter: number, at: Date) {
    const r = this.passkeys.get(id);
    if (r) {
      r.counter = counter;
      r.lastUsedAt = at;
    }
  }
  async deletePasskey(id: string, userId: string) {
    const r = this.passkeys.get(id);
    if (!r || r.userId !== userId) return false;
    return this.passkeys.delete(id);
  }

  async getBusinessPolicy(businessId: string) {
    return { requireStrongAuth: this.policies.get(businessId) ?? false };
  }
  async setBusinessPolicy(businessId: string, requireStrongAuth: boolean, _updatedBy?: string, _at?: Date) {
    this.policies.set(businessId, requireStrongAuth);
  }

  /** Account purge (MemoryRepository.purgeUserData). */
  dropUser(userId: string) {
    for (const [id, s] of this.sessions) if (s.userId === userId) this.sessions.delete(id);
    for (const [id, k] of this.passkeys) if (k.userId === userId) this.passkeys.delete(id);
  }
}
