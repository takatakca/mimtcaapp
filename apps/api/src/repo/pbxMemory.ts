import { randomUUID } from "node:crypto";
import { DEFAULT_RECORDING_POLICY } from "@mimt/shared";
import type {
  BusinessHours,
  BusinessMemberRow,
  BusinessRow,
  BusinessSeats,
  DidRouteRow,
  ExtensionRow,
  IvrMenuRow,
  PbxRepository,
  RecordingRow,
  RingGroupRow,
  UserMinutes,
} from "./pbxTypes.js";
import type { Call } from "./types.js";

const clone = <T>(v: T): T => structuredClone(v);
const ACTIVE_CALL_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress"]);

function patchRow<T extends object>(map: Map<string, T>, id: string, patch: Partial<T>, what: string): T {
  const row = map.get(id);
  if (!row) throw new Error(`${what} ${id} not found`);
  Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  return clone(row);
}

/** In-memory PBX store. `calls` reads the parent MemoryRepository's calls (business CDR). */
export class MemoryPbxRepository implements PbxRepository {
  businesses = new Map<string, BusinessRow>();
  members = new Map<string, BusinessMemberRow>();
  extensions = new Map<string, ExtensionRow>();
  ringGroups = new Map<string, RingGroupRow>();
  ivrMenus = new Map<string, IvrMenuRow>();
  hours = new Map<string, BusinessHours>();
  didRoutes = new Map<string, DidRouteRow>();
  recordings = new Map<string, RecordingRow>();
  seats = new Map<string, BusinessSeats>();

  constructor(private readonly calls: () => Iterable<Call>) {}

  // businesses
  async createBusiness(b: Parameters<PbxRepository["createBusiness"]>[0]) {
    if (b.takatakBusinessId && [...this.businesses.values()].some((x) => x.takatakBusinessId === b.takatakBusinessId)) {
      throw new Error("duplicate takatak_business_id");
    }
    const row: BusinessRow = { recordingPolicy: clone(DEFAULT_RECORDING_POLICY), ...b, id: randomUUID(), createdAt: new Date() };
    this.businesses.set(row.id, row);
    return clone(row);
  }
  async getBusiness(id: string) {
    const b = this.businesses.get(id);
    return b ? clone(b) : null;
  }
  async getBusinessByAccount(telecomAccountId: string) {
    const b = [...this.businesses.values()].find((x) => x.telecomAccountId === telecomAccountId);
    return b ? clone(b) : null;
  }
  async updateBusiness(id: string, patch: Parameters<PbxRepository["updateBusiness"]>[1]) {
    return patchRow(this.businesses, id, patch, "business");
  }
  async listBusinessesForUser(userId: string) {
    const out: Array<{ business: BusinessRow; member: BusinessMemberRow }> = [];
    for (const m of this.members.values()) {
      if (m.userId !== userId || m.status !== "active") continue;
      const business = this.businesses.get(m.businessId);
      if (business) out.push({ business: clone(business), member: clone(m) });
    }
    return out.sort((a, b) => a.business.createdAt.getTime() - b.business.createdAt.getTime());
  }

  // members
  async addMember(m: Parameters<PbxRepository["addMember"]>[0]) {
    const dup = [...this.members.values()].some(
      (x) =>
        x.businessId === m.businessId &&
        ((m.userId && x.userId === m.userId) || (m.email && x.email?.toLowerCase() === m.email.toLowerCase())),
    );
    if (dup) throw new Error("duplicate business member");
    const row: BusinessMemberRow = { claimedAt: null, ...m, id: randomUUID(), createdAt: new Date() };
    this.members.set(row.id, row);
    return clone(row);
  }
  async getMember(id: string) {
    const m = this.members.get(id);
    return m ? clone(m) : null;
  }
  async getMembership(businessId: string, userId: string) {
    const m = [...this.members.values()].find((x) => x.businessId === businessId && x.userId === userId && x.status === "active");
    return m ? clone(m) : null;
  }
  async findMemberByEmail(businessId: string, email: string) {
    const e = email.toLowerCase();
    const m = [...this.members.values()].find((x) => x.businessId === businessId && x.email?.toLowerCase() === e);
    return m ? clone(m) : null;
  }
  async listMembers(businessId: string) {
    return [...this.members.values()]
      .filter((m) => m.businessId === businessId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async updateMember(id: string, patch: Partial<Pick<BusinessMemberRow, "role">>) {
    return patchRow(this.members, id, patch, "member");
  }
  async deleteMember(id: string) {
    return this.members.delete(id);
  }
  async claimInvites(userId: string, email: string, at: Date) {
    const e = email.toLowerCase();
    const out: BusinessMemberRow[] = [];
    for (const m of this.members.values()) {
      if (m.status !== "invited" || m.email?.toLowerCase() !== e) continue;
      // Already a member of that business under another row: leave the invitation alone.
      if ([...this.members.values()].some((x) => x.businessId === m.businessId && x.userId === userId)) continue;
      Object.assign(m, { userId, status: "active", claimedAt: at });
      out.push(clone(m));
    }
    return out;
  }

  // extensions
  async createExtension(e: Parameters<PbxRepository["createExtension"]>[0]) {
    if ([...this.extensions.values()].some((x) => x.businessId === e.businessId && x.number === e.number)) throw new Error("duplicate extension");
    const row: ExtensionRow = { ...clone(e), id: randomUUID(), createdAt: new Date() };
    this.extensions.set(row.id, row);
    return clone(row);
  }
  async getExtension(id: string) {
    const e = this.extensions.get(id);
    return e ? clone(e) : null;
  }
  async findExtensionByNumber(businessId: string, number: string) {
    const e = [...this.extensions.values()].find((x) => x.businessId === businessId && x.number === number);
    return e ? clone(e) : null;
  }
  async listExtensions(businessId: string) {
    return [...this.extensions.values()]
      .filter((e) => e.businessId === businessId)
      .sort((a, b) => a.number.localeCompare(b.number))
      .map(clone);
  }
  async listExtensionsByUser(userId: string) {
    return [...this.extensions.values()].filter((e) => e.userId === userId).map(clone);
  }
  async updateExtension(id: string, patch: Parameters<PbxRepository["updateExtension"]>[1]) {
    const cur = this.extensions.get(id);
    if (cur && patch.number && patch.number !== cur.number) {
      if ([...this.extensions.values()].some((x) => x.businessId === cur.businessId && x.number === patch.number)) throw new Error("duplicate extension");
    }
    return patchRow(this.extensions, id, clone(patch), "extension");
  }
  async deleteExtension(id: string) {
    for (const g of this.ringGroups.values()) g.memberExtensionIds = g.memberExtensionIds.filter((x) => x !== id);
    return this.extensions.delete(id);
  }

  // ring groups
  async createRingGroup(g: Parameters<PbxRepository["createRingGroup"]>[0]) {
    const row: RingGroupRow = { ...clone(g), id: randomUUID(), createdAt: new Date() };
    this.ringGroups.set(row.id, row);
    return clone(row);
  }
  async getRingGroup(id: string) {
    const g = this.ringGroups.get(id);
    return g ? clone(g) : null;
  }
  async listRingGroups(businessId: string) {
    return [...this.ringGroups.values()]
      .filter((g) => g.businessId === businessId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async updateRingGroup(id: string, patch: Parameters<PbxRepository["updateRingGroup"]>[1]) {
    return patchRow(this.ringGroups, id, clone(patch), "ring group");
  }
  async deleteRingGroup(id: string) {
    return this.ringGroups.delete(id);
  }

  // IVR
  async createIvrMenu(m: Parameters<PbxRepository["createIvrMenu"]>[0]) {
    const row: IvrMenuRow = { ...clone(m), id: randomUUID(), createdAt: new Date() };
    this.ivrMenus.set(row.id, row);
    return clone(row);
  }
  async getIvrMenu(id: string) {
    const m = this.ivrMenus.get(id);
    return m ? clone(m) : null;
  }
  async listIvrMenus(businessId: string) {
    return [...this.ivrMenus.values()]
      .filter((m) => m.businessId === businessId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async updateIvrMenu(id: string, patch: Parameters<PbxRepository["updateIvrMenu"]>[1]) {
    return patchRow(this.ivrMenus, id, clone(patch), "ivr menu");
  }
  async deleteIvrMenu(id: string) {
    return this.ivrMenus.delete(id);
  }

  // hours
  async getHours(businessId: string) {
    const h = this.hours.get(businessId);
    return h ? clone(h) : null;
  }
  async putHours(h: BusinessHours) {
    const row = clone(h);
    row.holidays = [...new Map(row.holidays.map((x) => [x.date, x])).values()].sort((a, b) => a.date.localeCompare(b.date));
    this.hours.set(h.businessId, row);
    return clone(row);
  }

  // DID routes
  async upsertDidRoute(r: Parameters<PbxRepository["upsertDidRoute"]>[0]) {
    const existing = [...this.didRoutes.values()].find((x) => x.phoneNumberId === r.phoneNumberId);
    if (existing) {
      Object.assign(existing, clone(r));
      return clone(existing);
    }
    const row: DidRouteRow = { ...clone(r), id: randomUUID(), createdAt: new Date() };
    this.didRoutes.set(row.id, row);
    return clone(row);
  }
  async getDidRoute(id: string) {
    const r = this.didRoutes.get(id);
    return r ? clone(r) : null;
  }
  async getDidRouteByE164(e164: string) {
    const r = [...this.didRoutes.values()].find((x) => x.e164 === e164);
    return r ? clone(r) : null;
  }
  async listDidRoutes(businessId: string) {
    return [...this.didRoutes.values()].filter((r) => r.businessId === businessId).map(clone);
  }
  async deleteDidRoute(id: string) {
    return this.didRoutes.delete(id);
  }

  // recordings
  async createRecording(r: Parameters<PbxRepository["createRecording"]>[0]) {
    const existing = [...this.recordings.values()].find((x) => x.recordingSid === r.recordingSid);
    if (existing) return clone(existing);
    const row: RecordingRow = { ...r, id: randomUUID(), createdAt: new Date() };
    this.recordings.set(row.id, row);
    return clone(row);
  }
  async getRecording(id: string) {
    const r = this.recordings.get(id);
    return r ? clone(r) : null;
  }
  async listRecordings(businessId: string, opts: { userId?: string; limit?: number } = {}) {
    return [...this.recordings.values()]
      .filter((r) => r.businessId === businessId && (!opts.userId || r.userId === opts.userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, opts.limit ?? 200)
      .map(clone);
  }
  async listExpiredRecordings(now: Date, limit: number) {
    return [...this.recordings.values()].filter((r) => r.deleteAfter <= now).slice(0, limit).map(clone);
  }
  async deleteRecording(id: string) {
    return this.recordings.delete(id);
  }

  // seats
  async getSeats(businessId: string) {
    return clone(this.seats.get(businessId) ?? { businessId, seats: 1, stripeSubscriptionId: null });
  }
  async setSeats(businessId: string, seats: number, stripeSubscriptionId?: string | null) {
    const cur = await this.getSeats(businessId);
    const row: BusinessSeats = { businessId, seats, stripeSubscriptionId: stripeSubscriptionId === undefined ? cur.stripeSubscriptionId : stripeSubscriptionId };
    this.seats.set(businessId, row);
    return clone(row);
  }

  // business CDR
  async listBusinessCalls(telecomAccountId: string, opts: { userId?: string; limit: number; before?: { startedAt: Date; id: string } }) {
    const { before } = opts;
    return [...this.calls()]
      .filter((c) => c.telecomAccountId === telecomAccountId && (!opts.userId || c.userId === opts.userId))
      .filter(
        (c) => !before || c.startedAt < before.startedAt || (c.startedAt.getTime() === before.startedAt.getTime() && c.id < before.id),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (b.id < a.id ? -1 : 1))
      .slice(0, opts.limit)
      .map(clone);
  }
  async countActiveCallsByUser(telecomAccountId: string, userId: string, since: Date) {
    return [...this.calls()].filter(
      (c) =>
        c.telecomAccountId === telecomAccountId &&
        c.userId === userId &&
        c.kind !== "emergency" &&
        ACTIVE_CALL_STATUSES.has(c.status) &&
        c.startedAt >= since,
    ).length;
  }
  async minutesByUser(telecomAccountId: string, since: Date) {
    const by = new Map<string, UserMinutes>();
    for (const c of this.calls()) {
      if (c.telecomAccountId !== telecomAccountId || !c.userId || c.kind !== "pstn" || c.status !== "completed" || c.startedAt < since) continue;
      const row = by.get(c.userId) ?? { userId: c.userId, outboundMinutes: 0, inboundMinutes: 0 };
      const minutes = Math.ceil((c.durationS ?? 0) / 60);
      if (c.direction === "outbound") row.outboundMinutes += minutes;
      else row.inboundMinutes += minutes;
      by.set(c.userId, row);
    }
    return [...by.values()].sort((a, b) => a.userId.localeCompare(b.userId));
  }
}
