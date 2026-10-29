// Demo fixtures for « MIMT Connect » (VITE_MOCK_API=1). Same routes and rules as apps/api routes/partners.ts (owner
// view): the demo business is already a partner; a key is shown once, then only its prefix; the webhook secret is
// returned when first set or rotated.
import type { PartnerApiKeyDto, PartnerCallDto, PartnerOverviewResponse } from "@mimt/shared";
import type { MockHelpers, MockRoute } from "./mock.meetings";

interface State {
  keys: PartnerApiKeyDto[];
  webhookUrl: string | null;
  hasSecret: boolean;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const fresh = (): State => ({
  keys: [{ id: "pk-1", prefix: "mimt_pk_Q3x9aB", label: "Site besoinavocat.ca", createdAt: ago(60 * 24 * 3), lastUsedAt: ago(4), revokedAt: null }],
  webhookUrl: "https://besoinavocat.ca/api/mimt/webhook",
  hasSecret: true,
});
let state = fresh();

export function resetPartnerMock() {
  state = fresh();
}

const demoCalls = (): PartnerCallDto[] => [
  { id: "pc-2", direction: "inbound", huntGroup: "trouver-un-avocat", externalId: "avocat-42", from: "+14385550199", to: "+15145550100", startedAt: ago(12), answeredAt: ago(12), endedAt: ago(5), durationS: 412, credits: 14, billing: "billed", recordingUrl: null, recordingUrlExpiresAt: null },
  { id: "pc-1", direction: "inbound", huntGroup: "trouver-un-avocat", externalId: null, from: "+15145550123", to: "+15145550100", startedAt: ago(90), answeredAt: null, endedAt: ago(89), durationS: 0, credits: 0, billing: "free", recordingUrl: null, recordingUrlExpiresAt: null },
];

const randomKey = () => `mimt_pk_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => (b % 36).toString(36)).join("")}`;

export function partnerMockRoutes(h: Pick<MockHelpers, "ok" | "created" | "fail" | "nextId">): MockRoute[] {
  const B = "/v1/business/([^/]+)/partner";
  const view = (businessId: string): PartnerOverviewResponse => ({
    partner: { id: "partner-demo", businessId, name: "besoinavocat.ca", status: "active", creditPerMinute: 2, balance: 4820, webhookUrl: state.webhookUrl, createdAt: ago(60 * 24 * 10) },
    apiKeys: state.keys,
    calls: demoCalls(),
  });
  const issue = (label: string | null) => {
    if (state.keys.filter((k) => !k.revokedAt).length >= 5) return h.fail(409, "too_many_keys");
    const key = randomKey();
    const apiKey: PartnerApiKeyDto = { id: h.nextId("pk"), prefix: key.slice(0, 14), label, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
    state.keys.unshift(apiKey);
    return h.created({ key, apiKey });
  };
  const revoke = (keyId: string) => {
    const k = state.keys.find((x) => x.id === keyId && !x.revokedAt);
    if (!k) return null;
    k.revokedAt = new Date().toISOString();
    return k;
  };
  return [
    ["GET", new RegExp(`^${B}$`), ({ params }) => h.ok(view(params[0]!))],
    ["POST", new RegExp(`^${B}/keys$`), ({ body }) => issue((body as { label?: string | null } | undefined)?.label ?? null)],
    ["DELETE", new RegExp(`^${B}/keys/([^/]+)$`), ({ params }) => (revoke(params[1]!) ? new Response(null, { status: 204 }) : h.fail(404, "key_not_found"))],
    ["POST", new RegExp(`^${B}/keys/([^/]+)/rotate$`), ({ params }) => {
      const old = revoke(params[1]!);
      return old ? issue(old.label) : h.fail(404, "key_not_found");
    }],
    ["PUT", new RegExp(`^${B}/webhook$`), ({ body }) => {
      const b = body as { url: string | null; rotateSecret?: boolean };
      if (b.url && !/^https:\/\/[^/]+\.[^/]+/.test(b.url)) return h.fail(400, "https_required");
      const secret = b.url && (!state.hasSecret || b.rotateSecret) ? `whsec_${randomKey().slice(8)}` : null;
      state.webhookUrl = b.url;
      if (secret) state.hasSecret = true;
      return h.ok({ webhookUrl: b.url, secret });
    }],
  ];
}
