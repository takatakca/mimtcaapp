import type { HandleRepository, HandleRow } from "./handles.js";

export class MemoryHandleRepository implements HandleRepository {
  readonly rows = new Map<string, HandleRow>();

  async forUser(userId: string) {
    return [...this.rows.values()].find((r) => r.userId === userId) ?? null;
  }
  async find(handle: string) {
    return this.rows.get(handle) ?? null;
  }
  async create(row: Omit<HandleRow, "createdAt">) {
    if (this.rows.has(row.handle) || (await this.forUser(row.userId))) return null;
    const created = { ...row, createdAt: new Date() };
    this.rows.set(row.handle, created);
    return created;
  }
}
