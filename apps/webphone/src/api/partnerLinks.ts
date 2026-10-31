// « MIMT Connect » account links, from the MIMT user's side (/lier consent page, Compte › Intégrations › Partenaires).
// API: apps/api/src/routes/partners.ts (/v1/me/partner-links*); spec docs/MIMT-CONNECT.md « Liaison de compte » and
// « Consentement » (scopes, receipts, access log).
import type {
  MyPartnerAvailabilityRequest,
  MyPartnerLinkDto,
  MyPartnerLinksResponse,
  PartnerAccessLogResponse,
  PartnerConsentReceiptDto,
  PartnerLinkApproveRequest,
  PartnerLinkCodeRequest,
  PartnerLinkPreview,
  PartnerScope,
  PartnerScopeRevokeResponse,
} from "@mimt/shared";
import type { HttpClient } from "./http";

const P = "/v1/me/partner-links";

export function partnerLinkEndpoints(request: HttpClient["request"]) {
  return {
    previewPartnerLink: (body: PartnerLinkCodeRequest) => request<PartnerLinkPreview>("POST", `${P}/preview`, { body }),
    /** Step-up protected: 403 step_up_required until the person confirms (useStepUp). Sends the scopes checked. */
    approvePartnerLink: (body: PartnerLinkApproveRequest) => request<MyPartnerLinkDto>("POST", `${P}/approve`, { body }),
    myPartnerLinks: () => request<MyPartnerLinksResponse>("GET", P),
    revokePartnerLink: (id: string) => request<void>("DELETE", `${P}/${encodeURIComponent(id)}`),
    /** Removes one access at once; removing the last one removes the link. */
    revokePartnerScope: (id: string, scope: PartnerScope) =>
      request<PartnerScopeRevokeResponse>("DELETE", `${P}/${encodeURIComponent(id)}/scopes/${encodeURIComponent(scope)}`),
    /** « Journal d'accès »: the partner's last 50 accesses to the person's data. */
    partnerAccessLog: (id: string) => request<PartnerAccessLogResponse>("GET", `${P}/${encodeURIComponent(id)}/access-log`),
    partnerReceipts: (id: string) => request<{ receipts: PartnerConsentReceiptDto[] }>("GET", `${P}/${encodeURIComponent(id)}/receipts`),
    /** The person's own availability for this partner's hunt groups (null: the partner decides). */
    setPartnerAvailability: (id: string, body: MyPartnerAvailabilityRequest) =>
      request<MyPartnerLinkDto>("PUT", `${P}/${encodeURIComponent(id)}/availability`, { body }),
  };
}
