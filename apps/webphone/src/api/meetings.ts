// Réunions MIMT endpoints (/v1/meetings). Shapes come from packages/shared/src/meetings.ts.
// The guest routes are public (no bearer token): the guest token in the body is the capability.
import type {
  AdmitParticipantRequest,
  CreateMeetingInvitesRequest,
  CreateMeetingInvitesResponse,
  CreateMeetingRequest,
  GuestJoinRequest,
  GuestMeetingInfoResponse,
  Meeting,
  MeetingDetailResponse,
  MeetingsResponse,
  MeetingTokenResponse,
  UpdateMeetingRequest,
} from "@mimt/shared";
import type { HttpClient } from "./http";

const m = (id: string) => `/v1/meetings/${encodeURIComponent(id)}`;

export function meetingEndpoints(request: HttpClient["request"]) {
  return {
    meetings: () => request<MeetingsResponse>("GET", "/v1/meetings"),
    createMeeting: (body: CreateMeetingRequest) => request<Meeting>("POST", "/v1/meetings", { body }),
    meeting: (id: string) => request<MeetingDetailResponse>("GET", m(id)),
    updateMeeting: (id: string, body: UpdateMeetingRequest) => request<Meeting>("PATCH", m(id), { body }),
    inviteToMeeting: (id: string, body: CreateMeetingInvitesRequest) => request<CreateMeetingInvitesResponse>("POST", `${m(id)}/invites`, { body }),
    meetingToken: (id: string) => request<MeetingTokenResponse>("POST", `${m(id)}/token`, { body: {} }),
    admitToMeeting: (id: string, body: AdmitParticipantRequest) => request<{ admitted: string }>("POST", `${m(id)}/admit`, { body }),
    endMeeting: (id: string) => request<Meeting>("POST", `${m(id)}/end`, { body: {} }),
    guestMeetingInfo: (guestToken: string) => request<GuestMeetingInfoResponse>("POST", "/v1/meetings/join/guest/info", { body: { guestToken }, auth: false }),
    joinMeetingAsGuest: (body: GuestJoinRequest) => request<MeetingTokenResponse>("POST", "/v1/meetings/join/guest", { body, auth: false }),
  };
}
