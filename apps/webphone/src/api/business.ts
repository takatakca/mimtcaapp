// MIMT Affaires admin endpoints (/v1/business/*). Shapes come from packages/shared/src/business.ts
// and ai.ts (AI receptionist).
import type {
  AiReceptionistConfigDto,
  AiReceptionistConfigRequest,
  BusinessCallsResponse,
  BusinessesResponse,
  BusinessHoursRequest,
  BusinessHoursResponse,
  BusinessRecordingsResponse,
  BusinessResponse,
  BusinessUsageResponse,
  DidRoute,
  DidRouteRequest,
  DidRoutesResponse,
  Extension,
  ExtensionRequest,
  ExtensionsResponse,
  InviteMemberRequest,
  IvrMenu,
  IvrMenuRequest,
  IvrMenusResponse,
  BusinessMember,
  MembersResponse,
  RecordingPolicyRequest,
  RingGroup,
  RingGroupRequest,
  RingGroupsResponse,
  SeatsResponse,
  UpdateMemberRequest,
} from "@mimt/shared";
import type { HttpClient } from "./http";

const b = (id: string) => `/v1/business/${encodeURIComponent(id)}`;
const seg = (id: string) => encodeURIComponent(id);

export function businessEndpoints(request: HttpClient["request"]) {
  return {
    businesses: () => request<BusinessesResponse>("GET", "/v1/business"),
    businessUsage: (id: string) => request<BusinessUsageResponse>("GET", `${b(id)}/usage`),
    businessCalls: (id: string, cursor?: string) =>
      request<BusinessCallsResponse>("GET", `${b(id)}/calls`, { query: { cursor, limit: 25 } }),
    setSeats: (id: string, count: number) => request<SeatsResponse>("POST", `${b(id)}/seats`, { body: { count } }),
    setRecordingPolicy: (id: string, body: RecordingPolicyRequest) =>
      request<BusinessResponse>("PUT", `${b(id)}/recording-policy`, { body }),

    members: (id: string) => request<MembersResponse>("GET", `${b(id)}/members`),
    inviteMember: (id: string, body: InviteMemberRequest) => request<BusinessMember>("POST", `${b(id)}/members`, { body }),
    updateMember: (id: string, memberId: string, body: UpdateMemberRequest) =>
      request<BusinessMember>("PATCH", `${b(id)}/members/${seg(memberId)}`, { body }),
    removeMember: (id: string, memberId: string) => request<void>("DELETE", `${b(id)}/members/${seg(memberId)}`),

    extensions: (id: string) => request<ExtensionsResponse>("GET", `${b(id)}/extensions`),
    createExtension: (id: string, body: ExtensionRequest) => request<Extension>("POST", `${b(id)}/extensions`, { body }),
    updateExtension: (id: string, extId: string, body: Partial<ExtensionRequest>) =>
      request<Extension>("PATCH", `${b(id)}/extensions/${seg(extId)}`, { body }),
    deleteExtension: (id: string, extId: string) => request<void>("DELETE", `${b(id)}/extensions/${seg(extId)}`),

    ringGroups: (id: string) => request<RingGroupsResponse>("GET", `${b(id)}/ring-groups`),
    createRingGroup: (id: string, body: RingGroupRequest) => request<RingGroup>("POST", `${b(id)}/ring-groups`, { body }),
    updateRingGroup: (id: string, rgId: string, body: RingGroupRequest) =>
      request<RingGroup>("PUT", `${b(id)}/ring-groups/${seg(rgId)}`, { body }),
    deleteRingGroup: (id: string, rgId: string) => request<void>("DELETE", `${b(id)}/ring-groups/${seg(rgId)}`),

    ivrMenus: (id: string) => request<IvrMenusResponse>("GET", `${b(id)}/ivr`),
    createIvrMenu: (id: string, body: IvrMenuRequest) => request<IvrMenu>("POST", `${b(id)}/ivr`, { body }),
    updateIvrMenu: (id: string, menuId: string, body: IvrMenuRequest) =>
      request<IvrMenu>("PUT", `${b(id)}/ivr/${seg(menuId)}`, { body }),
    deleteIvrMenu: (id: string, menuId: string) => request<void>("DELETE", `${b(id)}/ivr/${seg(menuId)}`),

    hours: (id: string) => request<BusinessHoursResponse>("GET", `${b(id)}/hours`),
    putHours: (id: string, body: BusinessHoursRequest) => request<BusinessHoursResponse>("PUT", `${b(id)}/hours`, { body }),

    dids: (id: string) => request<DidRoutesResponse>("GET", `${b(id)}/dids`),
    putDid: (id: string, body: DidRouteRequest) => request<DidRoute>("PUT", `${b(id)}/dids`, { body }),

    recordings: (id: string) => request<BusinessRecordingsResponse>("GET", `${b(id)}/recordings`),

    aiReceptionist: (id: string) => request<AiReceptionistConfigDto>("GET", `${b(id)}/ai-receptionist`),
    putAiReceptionist: (id: string, body: AiReceptionistConfigRequest) =>
      request<AiReceptionistConfigDto>("PUT", `${b(id)}/ai-receptionist`, { body }),
  };
}
