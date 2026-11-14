// Demo fixtures for « MIMT Connect » account links (VITE_MOCK_API=1). Same routes and rules as apps/api
// routes/partners.ts (/v1/me/partner-links*), simplified: one pending demo code from « BesoinAvocat » for avocat-42
// asking for every scope (calls.read and line.manage required), no step-up here. Demo link: /lier?code=BAVC2345
import {
  normalizeLinkCode,
  PARTNER_AVAILABILITY_STATUSES,
  PARTNER_CONSENT_TEXT_VERSION,
  PARTNER_SCOPE_SET_VERSION,
  PARTNER_SCOPES,
  PARTNER_TERMS_VERSION,
  type MyPartnerLinkDto,
  type PartnerAccessLogEntryDto,
  type PartnerAvailabilityStatus,
  type PartnerConsentReceiptDto,
  type PartnerLinkPreview,
  type PartnerScope,
} from "@mimt/shared";
import type { MockHelpers, MockRoute } from "./mock.meetings";

export const DEMO_LINK_CODE = "BAVC2345";

// Named from the shared catalogue (in its order) so scope names never look like i18n keys here.
const [CALLS_READ, CALLS_PLACE, LINE_MANAGE, SUBSCRIPTION_READ, PORTING_READ, AVAILABILITY_MANAGE, RECORDINGS_READ] = PARTNER_SCOPES;
const REQUIRED: PartnerScope[] = [CALLS_READ, LINE_MANAGE];
const PURPOSES: Record<PartnerScope, string> = {
  [CALLS_READ]: "Inscrire chaque appel de référence au dossier du client.",
  [CALLS_PLACE]: "Rappeler un client depuis le portail, avec votre ligne.",
  [LINE_MANAGE]: "Afficher votre ligne aux clients que nous vous envoyons.",
  [SUBSCRIPTION_READ]: "Vérifier que votre forfait permet de recevoir nos appels.",
  [PORTING_READ]: "Vous aider à transférer votre numéro de cabinet.",
  [AVAILABILITY_MANAGE]: "Ne vous envoyer des appels qu'aux heures que vous choisissez.",
  [RECORDINGS_READ]: "Contrôle de qualité des appels de référence, si vous l'acceptez.",
};

interface State {
  codeUsed: boolean;
  links: MyPartnerLinkDto[];
  receipts: Record<string, PartnerConsentReceiptDto[]>;
}

const fresh = (): State => ({ codeUsed: false, links: [], receipts: {} });
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
    kind: "link",
    partnerName: "BesoinAvocat",
    partnerLegalName: "BesoinAvocat inc.",
    privacyContactEmail: "vieprivee@besoinavocat.ca",
    termsVersion: PARTNER_TERMS_VERSION,
    externalId: "avocat-42",
    memberName: "Me Marie Tremblay",
    scopes: PARTNER_SCOPES.map((scope) => ({ scope, purpose: PURPOSES[scope], required: REQUIRED.includes(scope), granted: false })),
    currentScopes: [],
    consentVersion: PARTNER_CONSENT_TEXT_VERSION,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  const receipt = (link: MyPartnerLinkDto, action: PartnerConsentReceiptDto["action"], changed: PartnerScope[]): PartnerConsentReceiptDto => ({
    id: h.nextId("rc"),
    action,
    actor: "user",
    scopes: action === "revoked" ? [] : [...link.scopes],
    changed,
    requiredScopes: action === "revoked" ? [] : [...link.requiredScopes],
    purposes: action === "revoked" ? {} : { ...link.purposes },
    consentVersion: PARTNER_CONSENT_TEXT_VERSION,
    scopeSetVersion: PARTNER_SCOPE_SET_VERSION,
    termsVersion: PARTNER_TERMS_VERSION,
    device: "Chrome · Windows",
    network: "203.0.113.0/24",
    createdAt: new Date().toISOString(),
  });
  const addReceipt = (link: MyPartnerLinkDto, r: PartnerConsentReceiptDto) => {
    state.receipts[link.id] = [r, ...(state.receipts[link.id] ?? [])];
    link.receipt = r;
  };
  const demoLog = (link: MyPartnerLinkDto): PartnerAccessLogEntryDto[] => [
    { scope: CALLS_READ, route: "GET /v1/partner/calls", outcome: link.scopes.includes(CALLS_READ) ? "allowed" : "denied", at: new Date().toISOString() },
    {
      scope: SUBSCRIPTION_READ,
      route: "GET /v1/partner/members/:externalId/subscription",
      outcome: link.scopes.includes(SUBSCRIPTION_READ) ? "allowed" : "denied",
      at: new Date(Date.now() - 3600_000).toISOString(),
    },
  ];
  const own = (id: string | undefined) => state.links.find((l) => l.id === id);

  return [
    ["POST", new RegExp(`^${P}/preview$`), ({ body }) => check(body) ?? h.ok(preview())],
    [
      "POST",
      new RegExp(`^${P}/approve$`),
      ({ body }) => {
        const bad = check(body);
        if (bad) return bad;
        const b = body as { scopes?: PartnerScope[]; consentVersion?: string };
        if (b.consentVersion !== PARTNER_CONSENT_TEXT_VERSION) return h.fail(409, "consent_text_changed");
        const chosen = PARTNER_SCOPES.filter((s) => (b.scopes ?? []).includes(s));
        if (REQUIRED.some((s) => !chosen.includes(s))) return h.fail(400, "required_scope_missing");
        if (state.links.length) return h.fail(409, "already_linked_to_partner");
        state.codeUsed = true;
        const p = preview();
        const now = new Date().toISOString();
        const link: MyPartnerLinkDto = {
          id: h.nextId("pl"),
          partnerName: p.partnerName,
          partnerLegalName: p.partnerLegalName,
          privacyContactEmail: p.privacyContactEmail,
          externalId: p.externalId,
          memberName: p.memberName,
          lineNumber: null,
          scopes: chosen,
          requiredScopes: REQUIRED.filter((s) => chosen.includes(s)),
          purposes: Object.fromEntries(chosen.map((s) => [s, PURPOSES[s]])),
          consentVersion: PARTNER_CONSENT_TEXT_VERSION,
          consentCurrent: true,
          consentedAt: now,
          receipt: null,
          userStatus: null,
          effectiveStatus: "available",
          createdAt: now,
        };
        addReceipt(link, receipt(link, "granted", chosen));
        state.links.unshift(link);
        return h.created(link);
      },
    ],
    ["GET", new RegExp(`^${P}$`), () => h.ok({ links: state.links })],
    [
      "PUT",
      new RegExp(`^${P}/([^/]+)/availability$`),
      ({ params, body }) => {
        const link = own(params[0]);
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
      new RegExp(`^${P}/([^/]+)/scopes/([^/]+)$`),
      ({ params }) => {
        const link = own(params[0]);
        const scope = decodeURIComponent(params[1] ?? "") as PartnerScope;
        if (!link) return h.fail(404, "link_not_found");
        if (!link.scopes.includes(scope)) return h.fail(404, "scope_not_granted");
        link.scopes = link.scopes.filter((s) => s !== scope);
        link.requiredScopes = link.requiredScopes.filter((s) => s !== scope);
        delete link.purposes[scope];
        if (!link.scopes.length) {
          addReceipt(link, receipt(link, "revoked", [scope]));
          state.links = state.links.filter((l) => l.id !== link.id);
          return h.ok({ unlinked: true, link: null });
        }
        addReceipt(link, receipt(link, "scope_revoked", [scope]));
        return h.ok({ unlinked: false, link });
      },
    ],
    [
      "GET",
      new RegExp(`^${P}/([^/]+)/access-log$`),
      ({ params }) => {
        const link = own(params[0]);
        return link ? h.ok({ entries: demoLog(link), retentionDays: 90 }) : h.fail(404, "link_not_found");
      },
    ],
    [
      "GET",
      new RegExp(`^${P}/([^/]+)/receipts$`),
      ({ params }) => (state.receipts[params[0] ?? ""] ? h.ok({ receipts: state.receipts[params[0]!] }) : h.fail(404, "link_not_found")),
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
