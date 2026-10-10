import { randomUUID } from "node:crypto";
import { DEFAULT_CALL_SETTINGS, type CallSettings } from "@mimt/shared";
import type { BlockedNumber, CallControlsRepository } from "./callControls.js";

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryCallControlsRepository implements CallControlsRepository {
  blocks: BlockedNumber[] = [];
  settings = new Map<string, CallSettings>();

  async listBlocks(accountId: string) {
    return this.blocks
      .filter((b) => b.telecomAccountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
  async addBlock(input: { telecomAccountId: string; e164: string; label: string | null }) {
    const existing = this.blocks.find((b) => b.telecomAccountId === input.telecomAccountId && b.e164 === input.e164);
    if (existing) return { block: clone(existing), created: false };
    const row: BlockedNumber = { ...input, id: randomUUID(), createdAt: new Date() };
    this.blocks.push(row);
    return { block: clone(row), created: true };
  }
  async removeBlock(accountId: string, id: string) {
    const before = this.blocks.length;
    this.blocks = this.blocks.filter((b) => !(b.id === id && b.telecomAccountId === accountId));
    return this.blocks.length < before;
  }
  async isBlocked(accountId: string, e164: string) {
    return this.blocks.some((b) => b.telecomAccountId === accountId && b.e164 === e164);
  }

  async getCallSettings(accountId: string) {
    return clone(this.settings.get(accountId) ?? DEFAULT_CALL_SETTINGS);
  }
  async saveCallSettings(accountId: string, settings: CallSettings) {
    this.settings.set(accountId, clone(settings));
    return clone(settings);
  }
}
