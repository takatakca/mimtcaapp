// « MIMT Connect » consent fixtures shared by the partner tests: the partner's accepted terms (DPA) with a declared
// purpose per scope, a link request asking for scopes, and the person's approval of the scopes they check.
import { PARTNER_CONSENT_TEXT_VERSION, PARTNER_SCOPES, PARTNER_TERMS_VERSION, type PartnerScope, type PartnerScopeRequestItem } from "@mimt/shared";
import type { Ctx } from "./helpers.js";

export const purposeOf = (scope: PartnerScope) => `BesoinAvocat uses ${scope} to route referral calls to the lawyer.`;

/** Every scope, as declared in the partner's accepted terms. */
export const ALL_PURPOSES = Object.fromEntries(PARTNER_SCOPES.map((s) => [s, purposeOf(s)])) as Record<PartnerScope, string>;

/** A link request item per scope (none required unless listed). */
export const scopeItems = (scopes: readonly PartnerScope[] = PARTNER_SCOPES, required: readonly PartnerScope[] = []): PartnerScopeRequestItem[] =>
  scopes.map((scope) => ({ scope, purpose: purposeOf(scope), ...(required.includes(scope) ? { required: true } : {}) }));

export const termsBody = (purposes: Partial<Record<PartnerScope, string>> = ALL_PURPOSES) => ({
  termsVersion: PARTNER_TERMS_VERSION,
  acceptedAt: "2026-10-30T12:00:00.000Z",
  signerName: "Julie Gagnon",
  signerTitle: "Présidente",
  legalName: "BesoinAvocat inc.",
  privacyContactEmail: "vieprivee@besoinavocat.ca",
  purposes,
});

/** The admin records the partner's acceptance of the current terms (admin session is a fresh SMS sign-in: step-up ok). */
export async function acceptTerms(ctx: Ctx, adminAuth: Record<string, string>, partnerId: string, purposes?: Partial<Record<PartnerScope, string>>) {
  const res = await ctx.app.inject({ method: "POST", url: `/v1/admin/partners/${partnerId}/terms-acceptance`, headers: adminAuth, payload: termsBody(purposes) });
  if (res.statusCode !== 201) throw new Error(`terms acceptance failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string };
}

/** Approval body: the code, and the scopes the person checked (default: everything requested). */
export const approveBody = (r: { code: string; requestId?: string }, scopes: readonly PartnerScope[] = PARTNER_SCOPES) => ({
  code: r.code,
  ...(r.requestId ? { requestId: r.requestId } : {}),
  scopes: [...scopes],
  consentVersion: PARTNER_CONSENT_TEXT_VERSION,
});
