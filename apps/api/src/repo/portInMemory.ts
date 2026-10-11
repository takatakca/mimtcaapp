import { randomUUID } from "node:crypto";
import { PORT_IN_OPEN_NUMBER_STATUSES } from "@mimt/shared";
import { PortInNumberTakenError, type NewPortIn, type PortInNumberRow, type PortInRepository, type PortInRow, type PortInWithNumbers } from "./portIn.js";

const clone = <T>(v: T): T => structuredClone(v);
const isOpen = (n: PortInNumberRow) => (PORT_IN_OPEN_NUMBER_STATUSES as readonly string[]).includes(n.status);

/** In-memory port-in storage (tests, local dev). Tables are public for assertions. */
export class MemoryPortInRepository implements PortInRepository {
  requests = new Map<string, PortInRow>();
  numbers = new Map<string, PortInNumberRow>();

  private with(r: PortInRow): PortInWithNumbers {
    const numbers = [...this.numbers.values()].filter((n) => n.portInId === r.id).sort((a, b) => a.e164.localeCompare(b.e164));
    return clone({ request: r, numbers });
  }

  async create(r: NewPortIn, e164s: string[]) {
    for (const e164 of e164s) if (await this.findOpenNumber(e164)) throw new PortInNumberTakenError(e164);
    const now = new Date();
    const row: PortInRow = {
      ...clone(r),
      id: randomUUID(),
      status: "pending_signature",
      loaVersion: null,
      loaSignedName: null,
      loaSignedAt: null,
      loaSignedIp: null,
      loaUserAgent: null,
      loaSha256: null,
      carrierRef: null,
      statusReason: null,
      completedAt: null,
      canceledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(row.id, row);
    for (const e164 of e164s) {
      const n: PortInNumberRow = { id: randomUUID(), portInId: row.id, e164, status: "pending", focDate: null, rejectionReason: null, completedAt: null, createdAt: now, updatedAt: now };
      this.numbers.set(n.id, n);
    }
    return this.with(row);
  }

  async get(id: string) {
    const r = this.requests.get(id);
    return r ? this.with(r) : null;
  }

  async getByCarrierRef(carrierRef: string) {
    const r = [...this.requests.values()].find((x) => x.carrierRef === carrierRef);
    return r ? this.with(r) : null;
  }

  async listByAccounts(ids: string[]) {
    return [...this.requests.values()]
      .filter((r) => ids.includes(r.telecomAccountId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((r) => this.with(r));
  }

  async update(id: string, patch: Parameters<PortInRepository["update"]>[1]) {
    const row = this.requests.get(id);
    if (!row) throw new Error(`port-in ${id} not found`);
    if (patch.carrierRef && [...this.requests.values()].some((r) => r.id !== id && r.carrierRef === patch.carrierRef)) throw new Error("duplicate carrier_ref");
    Object.assign(row, clone(patch), { updatedAt: new Date() });
    return clone(row);
  }

  async updateNumber(id: string, patch: Parameters<PortInRepository["updateNumber"]>[1]) {
    const row = this.numbers.get(id);
    if (!row) throw new Error(`port-in number ${id} not found`);
    if (patch.status && (PORT_IN_OPEN_NUMBER_STATUSES as readonly string[]).includes(patch.status) && !isOpen(row)) {
      const other = await this.findOpenNumber(row.e164);
      if (other && other.id !== id) throw new PortInNumberTakenError(row.e164);
    }
    Object.assign(row, clone(patch), { updatedAt: new Date() });
    return clone(row);
  }

  async findOpenNumber(e164: string) {
    const n = [...this.numbers.values()].find((x) => x.e164 === e164 && isOpen(x));
    return n ? clone(n) : null;
  }
}
