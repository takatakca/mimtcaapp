// « MIMT Connect » account links, from the MIMT user's side (/lier consent page, Compte › Intégrations › Partenaires).
// API: apps/api/src/routes/partners.ts (/v1/me/partner-links*); spec docs/MIMT-CONNECT.md « Liaison de compte ».
import type { MyPartnerAvailabilityRequest, MyPartnerLinkDto, MyPartnerLinksResponse, PartnerLinkCodeRequest, PartnerLinkPreview } from "@mimt/shared";
import type { HttpClient } from "./http";

const P = "/v1/me/partner-links";

export function partnerLinkEndpoints(request: HttpClient["request"]) {
  return {
    previewPartnerLink: (body: PartnerLinkCodeRequest) => request<PartnerLinkPreview>("POST", `${P}/preview`, { body }),
    /** Step-up protected: 403 step_up_required until the person confirms (useStepUp). */
    approvePartnerLink: (body: PartnerLinkCodeRequest) => request<MyPartnerLinkDto>("POST", `${P}/approve`, { body }),
    myPartnerLinks: () => request<MyPartnerLinksResponse>("GET", P),
    revokePartnerLink: (id: string) => request<void>("DELETE", `${P}/${encodeURIComponent(id)}`),
    /** The person's own availability for this partner's hunt groups (null: the partner decides). */
    setPartnerAvailability: (id: string, body: MyPartnerAvailabilityRequest) =>
      request<MyPartnerLinkDto>("PUT", `${P}/${encodeURIComponent(id)}/availability`, { body }),
  };
}
