// Demo fixtures for « MIMT Connect » account links (VITE_MOCK_API=1). Same routes and rules as apps/api
// routes/partners.ts (/v1/me/partner-links*), simplified: one pending demo code from « BesoinAvocat » for avocat-42,
// no step-up here. Demo link: /lier?code=BAVC2345
import { normalizeLinkCode, PARTNER_AVAILABILITY_STATUSES, PARTNER_LINK_PERMISSIONS, type MyPartnerLinkDto, type PartnerAvailabilityStatus, type PartnerLinkPreview } from "@mimt/shared";
import type { MockHelpers, MockRoute } from "./mock.meetings";

export const DEMO_LINK_CODE = "BAVC2345";

interface State {
  codeUsed: boolean;
  links: MyPartnerLinkDto[];
}

const fresh = (): State => ({ codeUsed: false, links: [] });
let state = fresh();

export function resetPartnerLinksMock() {
  state = fresh();
}

export function partnerLinksMockRoutes(h: Pick<MockHelpers, "ok" | "created" | "fail" | "nextId">): MockRoute[] {
  const P = "/v1/me/partner-links";
  const check = (body: unknown): Response | null => {
    const code = normalizeLinkCode(String((body as { code?: unknown } | undefined)?.code ?? ""));
    if (code !== DEMO_LINK_CODE) return h.fail(400, "invalid_link_code");
    if (state.codeUsed) return h.fail(410, "link_code_expired");
    return null;
  };
  const preview = (): PartnerLinkPreview => ({
    requestId: "lr-demo",
    partnerName: "BesoinAvocat",
    externalId: "avocat-42",
    memberName: "Me Marie Tremblay",
    permissions: [...PARTNER_LINK_PERMISSIONS],
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  return [
    ["POST", new RegExp(`^${P}/preview$`), ({ body }) => check(body) ?? h.ok(preview())],
    [
      "POST",
      new RegExp(`^${P}/approve$`),
      ({ body }) => {
        const bad = check(body);
        if (bad) return bad;
        if (state.links.length) return h.fail(409, "already_linked_to_partner");
        state.codeUsed = true;
        const p = preview();
        const link: MyPartnerLinkDto = {
          id: h.nextId("pl"),
          partnerName: p.partnerName,
          externalId: p.externalId,
          memberName: p.memberName,
          lineNumber: null,
          permissions: p.permissions,
          userStatus: null,
          effectiveStatus: "available",
          createdAt: new Date().toISOString(),
        };
        state.links.unshift(link);
        return h.created(link);
      },
    ],
    ["GET", new RegExp(`^${P}$`), () => h.ok({ links: state.links })],
    [
      "PUT",
      new RegExp(`^${P}/([^/]+)/availability$`),
      ({ params, body }) => {
        const link = state.links.find((l) => l.id === params[0]);
        if (!link) return h.fail(404, "link_not_found");
        const status = (body as { status?: unknown } | undefined)?.status;
        if (status !== null && !(PARTNER_AVAILABILITY_STATUSES as readonly unknown[]).includes(status)) return h.fail(400, "invalid_request");
        // Demo: the partner leaves everyone available, so the person's own status is what applies.
        link.userStatus = status as PartnerAvailabilityStatus | null;
        link.effectiveStatus = link.userStatus ?? "available";
        return h.ok(link);
      },
    ],
    [
      "DELETE",
      new RegExp(`^${P}/([^/]+)$`),
      ({ params }) => {
        const before = state.links.length;
        state.links = state.links.filter((l) => l.id !== params[0]);
        return state.links.length < before ? new Response(null, { status: 204 }) : h.fail(404, "link_not_found");
      },
    ],
  ];
}
