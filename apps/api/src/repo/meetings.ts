import type { MeetingEventType, MeetingRole, MeetingStatus } from "@mimt/shared";

// Réunions MIMT storage (supabase/migrations/0010_meetings.sql). Reached through `Repository.meetings`.

export interface MeetingRow {
  id: string;
  businessId: string | null;
  hostUserId: string;
  title: string;
  roomName: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  status: MeetingStatus;
  lobbyEnabled: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingInviteRow {
  id: string;
  meetingId: string;
  email: string | null;
  userId: string | null;
  role: MeetingRole;
  /** SHA-256 hex of the guest token. The token itself is never stored. */
  guestTokenHash: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface MeetingEventRow {
  id: number;
  meetingId: string;
  type: MeetingEventType;
  identity: string | null;
  userId: string | null;
  at: Date;
}

export type NewMeeting = Pick<MeetingRow, "businessId" | "hostUserId" | "title" | "roomName" | "scheduledStart" | "scheduledEnd" | "lobbyEnabled">;
export type NewMeetingInvite = Pick<MeetingInviteRow, "meetingId" | "email" | "userId" | "role" | "guestTokenHash" | "expiresAt">;
export type NewMeetingEvent = Pick<MeetingEventRow, "meetingId" | "type"> & Partial<Pick<MeetingEventRow, "identity" | "userId" | "at">>;

export interface MeetingRepository {
  create(m: NewMeeting): Promise<MeetingRow>;
  get(id: string): Promise<MeetingRow | null>;
  getByRoomName(roomName: string): Promise<MeetingRow | null>;
  /** Meetings the user hosts, of the given businesses, or is invited to by user id. Newest first, at most `limit`. */
  listForUser(userId: string, businessIds: string[], limit?: number): Promise<MeetingRow[]>;
  update(id: string, patch: Partial<Pick<MeetingRow, "title" | "scheduledStart" | "scheduledEnd" | "lobbyEnabled" | "status" | "startedAt" | "endedAt">>): Promise<MeetingRow>;

  createInvite(i: NewMeetingInvite): Promise<MeetingInviteRow>;
  listInvites(meetingId: string): Promise<MeetingInviteRow[]>;
  getInviteByTokenHash(hash: string): Promise<MeetingInviteRow | null>;
  /** Sets used_at the first time only. */
  markInviteUsed(id: string, at: Date): Promise<void>;
  /** True when the user holds an invite (by user id) to this meeting. */
  isInvited(meetingId: string, userId: string): Promise<boolean>;

  /** Append-only. */
  addEvent(e: NewMeetingEvent): Promise<MeetingEventRow>;
  listEvents(meetingId: string): Promise<MeetingEventRow[]>;
}
