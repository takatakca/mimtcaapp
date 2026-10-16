import { randomUUID } from "node:crypto";
import type { MeetingEventRow, MeetingInviteRow, MeetingRepository, MeetingRow, NewMeeting, NewMeetingEvent, NewMeetingInvite } from "./meetings.js";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory meetings storage (tests, local dev). Tables are public for assertions. */
export class MemoryMeetingRepository implements MeetingRepository {
  meetings = new Map<string, MeetingRow>();
  invites = new Map<string, MeetingInviteRow>();
  events: MeetingEventRow[] = [];

  async create(m: NewMeeting) {
    if ([...this.meetings.values()].some((x) => x.roomName === m.roomName)) throw new Error("duplicate room_name");
    const now = new Date();
    const row: MeetingRow = { ...clone(m), id: randomUUID(), status: "scheduled", startedAt: null, endedAt: null, createdAt: now, updatedAt: now };
    this.meetings.set(row.id, row);
    return clone(row);
  }

  async get(id: string) {
    const m = this.meetings.get(id);
    return m ? clone(m) : null;
  }

  async getByRoomName(roomName: string) {
    const m = [...this.meetings.values()].find((x) => x.roomName === roomName);
    return m ? clone(m) : null;
  }

  async listForUser(userId: string, businessIds: string[], limit = 100) {
    const invited = new Set([...this.invites.values()].filter((i) => i.userId === userId).map((i) => i.meetingId));
    return [...this.meetings.values()]
      .filter((m) => m.hostUserId === userId || (m.businessId !== null && businessIds.includes(m.businessId)) || invited.has(m.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limit)
      .map(clone);
  }

  async update(id: string, patch: Parameters<MeetingRepository["update"]>[1]) {
    const row = this.meetings.get(id);
    if (!row) throw new Error(`meeting ${id} not found`);
    Object.assign(row, Object.fromEntries(Object.entries(clone(patch)).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
    return clone(row);
  }

  async createInvite(i: NewMeetingInvite) {
    if (i.guestTokenHash && [...this.invites.values()].some((x) => x.guestTokenHash === i.guestTokenHash)) throw new Error("duplicate guest_token_hash");
    const row: MeetingInviteRow = { ...clone(i), id: randomUUID(), usedAt: null, createdAt: new Date() };
    this.invites.set(row.id, row);
    return clone(row);
  }

  async listInvites(meetingId: string) {
    return [...this.invites.values()]
      .filter((i) => i.meetingId === meetingId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .map(clone);
  }

  async getInviteByTokenHash(hash: string) {
    const i = [...this.invites.values()].find((x) => x.guestTokenHash === hash);
    return i ? clone(i) : null;
  }

  async markInviteUsed(id: string, at: Date) {
    const i = this.invites.get(id);
    if (i && !i.usedAt) i.usedAt = at;
  }

  async isInvited(meetingId: string, userId: string) {
    return [...this.invites.values()].some((i) => i.meetingId === meetingId && i.userId === userId);
  }

  async addEvent(e: NewMeetingEvent) {
    const row: MeetingEventRow = { id: this.events.length + 1, meetingId: e.meetingId, type: e.type, identity: e.identity ?? null, userId: e.userId ?? null, at: e.at ?? new Date() };
    this.events.push(row);
    return clone(row);
  }

  async listEvents(meetingId: string) {
    return this.events.filter((e) => e.meetingId === meetingId).map(clone);
  }
}
