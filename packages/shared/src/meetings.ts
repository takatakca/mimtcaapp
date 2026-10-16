// Réunions MIMT: video meetings on LiveKit (open-source SFU, self-hosted on Coolify or LiveKit Cloud).
// Routes: apps/api/src/routes/meetings.ts. Storage: supabase/migrations/0010_meetings.sql.
// Docs: docs/MIMT-VIDEO.md. No recording (Loi 25): adding it later needs explicit consent first.

import type { PlanCode } from "./plans.js";

export const MEETING_STATUSES = ["scheduled", "live", "ended"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_ROLES = ["host", "participant", "guest"] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];

export const MEETING_EVENT_TYPES = ["started", "joined", "left", "ended", "admitted"] as const;
export type MeetingEventType = (typeof MEETING_EVENT_TYPES)[number];

/** Max simultaneous participants per meeting, by the plan of the account that hosts it. */
export const MEETING_PARTICIPANT_CAPS: Partial<Record<PlanCode, number>> = {
  premium: 4,
  business: 25,
  business_pro: 100,
};

/** Hard limit of one meeting, from the first join. */
export const MEETING_MAX_DURATION_S = 4 * 3600;
/** Lifetime of a LiveKit access token (rejoining asks for a new one). */
export const MEETING_TOKEN_TTL_S = 3600;
/** Lifetime of a guest invitation link. */
export const MEETING_GUEST_LINK_TTL_S = 7 * 86_400;
export const MEETING_MAX_INVITES_PER_REQUEST = 50;
export const MEETING_TITLE_MAX = 120;
export const MEETING_DISPLAY_NAME_MAX = 60;

/** Participant identities: users get their MIMT user id; guests get this prefix. */
export const MEETING_GUEST_IDENTITY_PREFIX = "guest-";

/** JSON stored in LiveKit participant metadata. `waiting` guests sit in the lobby until admitted. */
export interface MeetingParticipantMetadata {
  role: MeetingRole;
  waiting: boolean;
}

export function participantCap(plan: PlanCode): number | null {
  return MEETING_PARTICIPANT_CAPS[plan] ?? null;
}

export function parseParticipantMetadata(raw: string | null | undefined): MeetingParticipantMetadata | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MeetingParticipantMetadata>;
    if (!v || typeof v !== "object" || !MEETING_ROLES.includes(v.role as MeetingRole)) return null;
    return { role: v.role as MeetingRole, waiting: v.waiting === true };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------ DTOs

export interface Meeting {
  id: string;
  businessId: string | null;
  hostUserId: string;
  title: string;
  status: MeetingStatus;
  lobbyEnabled: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  /** app.mimt.ca page for signed-in members. */
  joinUrl: string;
  /** What the caller may do on it. */
  canManage: boolean;
  /** Participant cap of the plan behind this meeting. */
  maxParticipants: number;
}

export interface MeetingInviteDto {
  id: string;
  email: string | null;
  role: MeetingRole;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface MeetingsResponse {
  meetings: Meeting[];
}

export interface MeetingDetailResponse {
  meeting: Meeting;
  /** Only for those who can manage the meeting. */
  invites: MeetingInviteDto[];
}

export interface CreateMeetingRequest {
  title: string;
  /** Business meeting (owner/admin of that business). Absent: personal meeting on the caller's plan. */
  businessId?: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  lobbyEnabled?: boolean;
}

export interface UpdateMeetingRequest {
  title?: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  lobbyEnabled?: boolean;
}

export interface CreateMeetingInvitesRequest {
  /** One link per email. Empty or absent: one shareable link with no email. */
  emails?: string[];
}

export interface CreatedMeetingInvite extends MeetingInviteDto {
  /** Guest link (`/reunion/<token>`). Shown once: only a hash of the token is stored. */
  link: string;
  /** True when the invitation email was handed to the email provider. */
  emailed: boolean;
}

export interface CreateMeetingInvitesResponse {
  invites: CreatedMeetingInvite[];
}

export interface MeetingTokenResponse {
  /** wss:// URL of the LiveKit server. */
  url: string;
  token: string;
  identity: string;
  expiresAt: string;
  role: MeetingRole;
  canPublish: boolean;
  /** Guest waiting in the lobby: connected, cannot publish nor see others until admitted. */
  waiting: boolean;
  meeting: Pick<Meeting, "id" | "title" | "status" | "lobbyEnabled" | "maxParticipants">;
}

export interface GuestJoinRequest {
  guestToken: string;
  displayName: string;
}

export interface GuestMeetingInfoRequest {
  guestToken: string;
}

export interface GuestMeetingInfoResponse {
  title: string;
  hostName: string | null;
  status: MeetingStatus;
  lobbyEnabled: boolean;
  scheduledStart: string | null;
}

export interface AdmitParticipantRequest {
  identity: string;
}
