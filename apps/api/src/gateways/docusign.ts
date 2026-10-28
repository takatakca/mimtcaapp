// DocuSign eSignature for the affiliate agreement (docs/MIMT-AFFILIATES.md). JWT grant (service integration, the
// owner grants consent once), then one envelope per affiliate created from the owner's template, with the terms as
// text tabs named like the contract placeholders. Connect (webhook) messages are verified by HMAC.
// Nothing here runs unless every DOCUSIGN_* variable is set (config.ts docusignConfigured).
import { createHmac, createPrivateKey, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { Config } from "../config.js";
import { docusignConfigured } from "../config.js";
import { safeEqual } from "../lib/crypto.js";

/** Text tab labels of the DocuSign template = placeholders of docs/legal/contrat-affilie.md. */
export const CONTRACT_TABS = ["affiliate_legal_name", "commission_pct", "duration_months", "payout_threshold", "effective_date"] as const;
export type ContractTabs = Record<(typeof CONTRACT_TABS)[number], string>;

export interface ContractEnvelopeInput {
  affiliateId: string;
  signerName: string;
  signerEmail: string;
  locale: "fr-CA" | "en-CA";
  tabs: ContractTabs;
}

export interface ContractGateway {
  /** Creates and sends the envelope from the template. Returns its id (stored on the affiliate). */
  sendContract(input: ContractEnvelopeInput): Promise<{ envelopeId: string }>;
}

type FetchFn = typeof fetch;

/** demo.docusign.net → account-d.docusign.com; any production REST host → account.docusign.com. */
export function docusignAuthHost(baseUrl: string): string {
  return new URL(baseUrl).hostname.startsWith("demo.") ? "account-d.docusign.com" : "account.docusign.com";
}

export class DocuSignGateway implements ContractGateway {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: {
      accountId: string;
      integrationKey: string;
      userId: string;
      privateKeyPem: string;
      baseUrl: string;
      templateId: string;
      templateRole: string;
    },
    private readonly http: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** OAuth JWT grant (scope signature impersonation). Cached until 5 minutes before it expires. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 300_000 > this.now()) return this.token.value;
    const authHost = docusignAuthHost(this.cfg.baseUrl);
    const iat = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: "signature impersonation" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.cfg.integrationKey)
      .setSubject(this.cfg.userId)
      .setAudience(authHost)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .setJti(randomUUID())
      .sign(createPrivateKey(this.cfg.privateKeyPem));
    const res = await this.http(`https://${authHost}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    // Never log the response body: it carries the access token (or consent details).
    if (!res.ok) throw new Error(`DocuSign token request failed (${res.status})`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("DocuSign returned no access token");
    this.token = { value: json.access_token, expiresAt: this.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  async sendContract(input: ContractEnvelopeInput) {
    const token = await this.accessToken();
    const base = this.cfg.baseUrl.replace(/\/$/, "");
    const fr = input.locale === "fr-CA";
    const body = {
      templateId: this.cfg.templateId,
      status: "sent",
      emailSubject: fr ? "MIMT : votre contrat d'agent affilié à signer" : "MIMT: your affiliate agent agreement to sign",
      templateRoles: [
        {
          roleName: this.cfg.templateRole,
          name: input.signerName,
          email: input.signerEmail,
          tabs: { textTabs: CONTRACT_TABS.map((tabLabel) => ({ tabLabel, value: input.tabs[tabLabel], locked: "true" })) },
        },
      ],
      customFields: { textCustomFields: [{ name: "mimt_affiliate_id", value: input.affiliateId, show: "false" }] },
    };
    const res = await this.http(`${base}/v2.1/accounts/${encodeURIComponent(this.cfg.accountId)}/envelopes`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DocuSign envelope creation failed (${res.status})`);
    const json = (await res.json()) as { envelopeId?: string };
    if (!json.envelopeId) throw new Error("DocuSign returned no envelope id");
    return { envelopeId: json.envelopeId };
  }
}

export function createContractGateway(config: Config, http?: FetchFn): ContractGateway | null {
  if (!docusignConfigured(config)) return null;
  return new DocuSignGateway(
    {
      accountId: config.DOCUSIGN_ACCOUNT_ID!,
      integrationKey: config.DOCUSIGN_INTEGRATION_KEY!,
      userId: config.DOCUSIGN_USER_ID!,
      privateKeyPem: config.DOCUSIGN_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      baseUrl: config.DOCUSIGN_BASE_URL!,
      templateId: config.DOCUSIGN_TEMPLATE_ID!,
      templateRole: config.DOCUSIGN_TEMPLATE_ROLE,
    },
    http,
  );
}

/** DocuSign Connect HMAC: base64(HMAC-SHA256(key, raw body)) in X-DocuSign-Signature-1 (…-2 while a key rotates). */
export function connectSignature(key: string, rawBody: Buffer | string): string {
  return createHmac("sha256", key).update(rawBody).digest("base64");
}

export function verifyConnectSignature(key: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
  const expected = connectSignature(key, rawBody);
  for (let i = 1; i <= 5; i++) {
    const h = headers[`x-docusign-signature-${i}`];
    if (typeof h === "string" && safeEqual(h, expected)) return true;
  }
  return false;
}

/** Envelope id and status of a Connect message (JSON « SIM » format, or the older flat format). */
export function parseConnectEvent(payload: unknown): { envelopeId: string; status: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { event?: unknown; data?: { envelopeId?: unknown; envelopeSummary?: { status?: unknown } }; envelopeId?: unknown; status?: unknown };
  const envelopeId = typeof p.data?.envelopeId === "string" ? p.data.envelopeId : typeof p.envelopeId === "string" ? p.envelopeId : null;
  if (!envelopeId) return null;
  let status = typeof p.data?.envelopeSummary?.status === "string" ? p.data.envelopeSummary.status : typeof p.status === "string" ? p.status : "";
  if (!status && typeof p.event === "string" && p.event.startsWith("envelope-")) status = p.event.slice("envelope-".length);
  return { envelopeId, status: status.toLowerCase() };
}
