import { randomUUID } from "node:crypto";
import type { WebPushRepository, WebPushSubscriptionRow } from "./webPush.js";

export class MemoryWebPushRepository implements WebPushRepository {
  readonly subs = new Map<string, WebPushSubscriptionRow>();
  readonly keys = new Map<string, string>();

  async upsert(s: Omit<WebPushSubscriptionRow, "id" | "createdAt">) {
    const existing = this.subs.get(s.endpoint);
    const row = { id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? new Date(), ...s };
    this.subs.set(s.endpoint, row);
    return row;
  }
  async listForUser(userId: string) {
    return [...this.subs.values()].filter((s) => s.userId === userId);
  }
  async deleteByEndpoint(endpoint: string) {
    this.subs.delete(endpoint);
  }
  async getKey(name: string) {
    return this.keys.get(name) ?? null;
  }
  async putKeyOnce(name: string, valueEncrypted: string) {
    if (!this.keys.has(name)) this.keys.set(name, valueEncrypted);
    return this.keys.get(name)!;
  }
}
