// « MIMT Connect » two-sided granular consent (owner's order 2026-10-31; docs/MIMT-CONNECT.md « Consentement »).
//
// Partner side: before it can ask a member for anything, a MIMT admin records the partner's acceptance of the
// MIMT Connect partner terms and DPA (docs/legal/conditions-partenaire-mimt-connect.md) with a declared purpose per
// scope. A link request names the scopes it asks for, each with a purpose, only among the declared ones.
//
// Person side: each scope is a separate checkbox on /lier, unchecked by default; approval needs a recent step-up and
// every required scope. Each consent step leaves a receipt (scopes, text versions, time, coarse device and network,
// never a full IP), is notified to the person and to the partner (member.consent_updated, scopes only), and every
// partner access to the person's data is checked against the grant and written to the access log (90 days).
// Storage: src/repo/partners*.ts (0029_partner_consent.sql). Routes: src/routes/partners.ts.

import {
  PARTNER_ACCESS_LOG_LIMIT,
  PARTNER_ACCESS_LOG_RETENTION_DAYS,
  PARTNER_CONSENT_TEXT_VERSION,
  PARTNER_SCOPE_SET_VERSION,
  PARTNER_SCOPES,
  PARTNER_TERMS_VERSION,
  type PartnerAccessLogEntryDto,
  type PartnerCallDto,
  type PartnerConsentAction,
  type PartnerConsentReceiptDto,
  type PartnerScope,
  type PartnerScopeRequestItem,
  type PartnerTermsAcceptanceDto,
  type PartnerTermsAcceptanceRequest,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { coarseIp, coarseUserAgent } from "../lib/clientInfo.js";
import { badRequest, HttpError } from "../lib/errors.js";
import type {
  PartnerCallRow,
  PartnerConsentReceiptRow,
  PartnerGrant,
  PartnerLinkRequestRow,
  PartnerMemberLinkRow,
  PartnerMemberRow,
  PartnerRow,
  PartnerTermsAcceptanceRow,
} from "../repo/partners.js";
import { callDto, emitPartnerEvent } from "./partners.js";

/** What a partner API request touched, for the access log: « GET /v1/partner/members/:externalId/subscription ». */
export interface AccessContext {
  route: string;
}

/** The person's client at a consent step: only its coarse form is ever stored. */
export interface ConsentClient {
  ip: string;
  userAgent: unknown;
}

const ordered = (scopes: Iterable<PartnerScope>) => {
  const set = new Set(scopes);
  return PARTNER_SCOPES.filter((s) => set.has(s));
};

export const hasScope = (link: Pick<PartnerMemberLinkRow, "scopes" | "revokedAt"> | null | undefined, scope: PartnerScope) =>
  Boolean(link && !link.revokedAt && link.scopes.includes(scope));

/** 403 scope_not_granted, naming the missing scope. */
export const scopeNotGranted = (scope: PartnerScope) =>
  new HttpError(403, "scope_not_granted", `The linked person has not granted the « ${scope} » scope to this partner.`, { scope });

/** Writes one access log row (no body, no query string, no IP). Failing to log fails the request: no silent access. */
export async function logAccess(deps: AppDeps, link: PartnerMemberLinkRow, scope: PartnerScope, access: AccessContext, outcome: "allowed" | "denied") {
  await deps.repo.partners.logAccess({ partnerId: link.partnerId, linkId: link.id, scope, route: access.route.split("?")[0]!.slice(0, 120), outcome, at: deps.now() });
}

/** The partner may use `scope` on this linked person's data: logged either way, 403 scope_not_granted if not. */
export async function assertScope(deps: AppDeps, link: PartnerMemberLinkRow, scope: PartnerScope, access: AccessContext) {
  const ok = hasScope(link, scope);
  await logAccess(deps, link, scope, access, ok ? "allowed" : "denied");
  if (!ok) throw scopeNotGranted(scope);
}

// ------------------------------------------------------------------------------------- partner terms (DPA)

/** The partner's acceptance of the CURRENT terms version, or null. */
export async function currentTerms(deps: AppDeps, p: PartnerRow): Promise<PartnerTermsAcceptanceRow | null> {
  const t = await deps.repo.partners.latestTermsAcceptance(p.id);
  return t && t.termsVersion === PARTNER_TERMS_VERSION ? t : null;
}

/** 409 partner_terms_required until a MIMT admin records the partner's acceptance of the current terms and DPA. */
export async function requireCurrentTerms(deps: AppDeps, p: PartnerRow): Promise<PartnerTermsAcceptanceRow> {
  const t = await currentTerms(deps, p);
  if (!t) {
    throw new HttpError(409, "partner_terms_required", "The MIMT Connect partner terms and DPA must be accepted (current version) before asking members for access.", {
      termsVersion: PARTNER_TERMS_VERSION,
    });
  }
  return t;
}

export const termsDto = (t: PartnerTermsAcceptanceRow): PartnerTermsAcceptanceDto => ({
  id: t.id,
  termsVersion: t.termsVersion,
  current: t.termsVersion === PARTNER_TERMS_VERSION,
  acceptedAt: t.acceptedAt.toISOString(),
  signerName: t.signerName,
  signerTitle: t.signerTitle,
  legalName: t.legalName,
  privacyContactEmail: t.privacyContactEmail,
  purposes: { ...t.purposes },
  recordedAt: t.createdAt.toISOString(),
});

/** POST /v1/admin/partners/:id/terms-acceptance (admin + step-up checked by the route). Audited. */
export async function recordTermsAcceptance(deps: AppDeps, p: PartnerRow, body: PartnerTermsAcceptanceRequest, actor: { userId: string; ip: string }) {
  if (body.termsVersion !== PARTNER_TERMS_VERSION) {
    throw new HttpError(400, "terms_version_mismatch", `Only the current terms version (${PARTNER_TERMS_VERSION}) can be accepted.`, { termsVersion: PARTNER_TERMS_VERSION });
  }
  const acceptedAt = new Date(body.acceptedAt);
  const now = deps.now();
  if (acceptedAt.getTime() > now.getTime() + 5 * 60_000) throw badRequest("accepted_at_in_future", "acceptedAt cannot be in the future");
  const purposes = Object.fromEntries(ordered(Object.keys(body.purposes) as PartnerScope[]).map((s) => [s, body.purposes[s]!.trim()])) as Partial<Record<PartnerScope, string>>;
  if (!Object.keys(purposes).length) throw badRequest("purposes_required", "Declare a purpose for at least one scope");
  const row = await deps.repo.partners.addTermsAcceptance({
    partnerId: p.id,
    termsVersion: body.termsVersion,
    acceptedAt,
    signerName: body.signerName.trim(),
    signerTitle: body.signerTitle.trim(),
    legalName: body.legalName.trim(),
    privacyContactEmail: body.privacyContactEmail.trim(),
    purposes,
    recordedBy: actor.userId,
    at: now,
  });
  await deps.repo.audit({
    actorUserId: actor.userId,
    action: "partner.terms_accepted",
    targetType: "partner",
    targetId: p.id,
    ip: actor.ip,
    meta: { acceptanceId: row.id, termsVersion: row.termsVersion, scopes: Object.keys(purposes) },
  });
  return termsDto(row);
}

/**
 * A link request may only ask for scopes the partner declared in its current terms, each once, with a purpose.
 * Returns the items in display order with `required` made explicit.
 */
export function checkRequestedScopes(terms: PartnerTermsAcceptanceRow, items: PartnerScopeRequestItem[]): PartnerScopeRequestItem[] {
  const seen = new Set<PartnerScope>();
  for (const it of items) {
    if (seen.has(it.scope)) throw new HttpError(400, "duplicate_scope", `« ${it.scope} » is listed twice`, { scope: it.scope });
    seen.add(it.scope);
    if (!terms.purposes[it.scope]) {
      throw new HttpError(403, "scope_not_declared", `« ${it.scope} » is not among the purposes declared in your accepted partner terms`, { scope: it.scope });
    }
  }
  const byScope = new Map(items.map((it) => [it.scope, it]));
  return ordered(seen).map((s) => ({ scope: s, purpose: byScope.get(s)!.purpose.trim(), required: Boolean(byScope.get(s)!.required) }));
}

// --------------------------------------------------------------------------------------------------- grants

/**
 * The grant after the person checked `chosen` on a request. Scopes the request does not mention stay as they were
 * (upgrade); requested ones are granted only if checked. Refused: a scope that was not requested, a required scope
 * left unchecked, or nothing granted at all.
 */
export function computeGrant(current: PartnerGrant | null, req: Pick<PartnerLinkRequestRow, "scopes">, chosen: PartnerScope[]): { grant: PartnerGrant; changed: PartnerScope[] } {
  const requested = new Map(req.scopes.map((it) => [it.scope, it]));
  for (const s of chosen) if (!requested.has(s)) throw new HttpError(400, "scope_not_requested", `« ${s} » was not requested by the partner`, { scope: s });
  for (const it of req.scopes) {
    if (it.required && !chosen.includes(it.scope)) {
      throw new HttpError(400, "required_scope_missing", `The partner needs « ${it.scope} » for its service: check it or cancel`, { scope: it.scope });
    }
  }
  const kept = (current?.scopes ?? []).filter((s) => !requested.has(s));
  const scopes = ordered([...kept, ...chosen]);
  if (!scopes.length) throw badRequest("no_scope_selected", "Check at least one access, or cancel");
  const requiredScopes = scopes.filter((s) => (requested.has(s) ? Boolean(requested.get(s)!.required) : Boolean(current?.requiredScopes.includes(s))));
  const purposes = Object.fromEntries(scopes.map((s) => [s, requested.get(s)?.purpose ?? current?.purposes[s] ?? ""]).filter(([, v]) => v)) as Partial<Record<PartnerScope, string>>;
  const before = new Set(current?.scopes ?? []);
  const after = new Set(scopes);
  const changed = PARTNER_SCOPES.filter((s) => before.has(s) !== after.has(s));
  return { grant: { scopes, requiredScopes, purposes, consentVersion: PARTNER_CONSENT_TEXT_VERSION, scopeSetVersion: PARTNER_SCOPE_SET_VERSION }, changed };
}

export const grantOf = (l: PartnerMemberLinkRow): PartnerGrant => ({
  scopes: [...l.scopes],
  requiredScopes: [...l.requiredScopes],
  purposes: { ...l.purposes },
  consentVersion: l.consentVersion,
  scopeSetVersion: l.scopeSetVersion,
});

/**
 * The partner no longer controls availability (scope not granted or removed): its setting is cleared so it stops
 * deciding when the person's apps ring. The person's own status is kept.
 */
export async function dropPartnerAvailability(deps: AppDeps, link: PartnerMemberLinkRow) {
  const a = await deps.repo.partners.getAvailability(link.memberId);
  if (!a || (a.status === "available" && !a.weekly && !a.until)) return;
  await deps.repo.partners.upsertAvailability(link.partnerId, link.memberId, { status: "available", weekly: null, until: null });
}

// ------------------------------------------------------------------------------------------------ receipts

export const receiptDto = (r: PartnerConsentReceiptRow): PartnerConsentReceiptDto => ({
  id: r.id,
  action: r.action,
  actor: r.actor,
  scopes: [...r.scopes],
  changed: [...r.changed],
  requiredScopes: [...r.requiredScopes],
  purposes: { ...r.purposes },
  consentVersion: r.consentVersion,
  scopeSetVersion: r.scopeSetVersion,
  termsVersion: r.termsVersion,
  device: r.device,
  network: r.network,
  createdAt: r.createdAt.toISOString(),
});

/**
 * One consent step: the receipt (coarse device and network only), member.consent_updated to the partner (scopes
 * only; not on unlink, where member.unlinked says it), and a notice to the person (push, when configured).
 */
export async function recordConsent(
  deps: AppDeps,
  input: {
    partner: PartnerRow;
    member: PartnerMemberRow;
    link: PartnerMemberLinkRow;
    action: Exclude<PartnerConsentAction, "migrated">;
    actor: "user" | "partner" | "system";
    changed: PartnerScope[];
    client?: ConsentClient | undefined;
  },
): Promise<PartnerConsentReceiptRow> {
  const { partner, member, link } = input;
  const at = deps.now();
  const terms = await deps.repo.partners.latestTermsAcceptance(partner.id);
  const revoked = input.action === "revoked";
  const receipt = await deps.repo.partners.addConsentReceipt({
    linkId: link.id,
    partnerId: partner.id,
    memberId: member.id,
    userId: link.userId,
    action: input.action,
    actor: input.actor,
    scopes: revoked ? [] : [...link.scopes],
    changed: [...input.changed],
    requiredScopes: revoked ? [] : [...link.requiredScopes],
    purposes: revoked ? {} : { ...link.purposes },
    consentVersion: link.consentVersion,
    scopeSetVersion: link.scopeSetVersion,
    termsVersion: terms?.termsVersion ?? null,
    device: input.client ? coarseUserAgent(input.client.userAgent) : null,
    network: input.client ? coarseIp(input.client.ip) : null,
    at,
  });
  if (!revoked) {
    await emitPartnerEvent(
      deps,
      partner,
      "member.consent_updated",
      { member_external_id: member.externalId, scopes: [...link.scopes], consent_version: link.consentVersion, updated_at: at.toISOString() },
      { linkId: link.id },
    );
  }
  try {
    await deps.notifier.notify(link.userId, "partner_consent_receipt", { partner: partner.name, action: input.action });
  } catch {
    // The receipt is stored and shown in Compte › Intégrations; a push that fails changes nothing.
  }
  return receipt;
}

// --------------------------------------------------------------------------------------- calls and access log

/**
 * Calls as the partner may see them. A call made or answered under an account link is shown only while that link is
 * active and grants calls.read; its recording URL only with recordings.read. Calls with no link (unanswered, or a
 * member without a MIMT link) are the partner's own business records. Each link whose data is returned is logged.
 */
export async function visibleCallDtos(deps: AppDeps, p: PartnerRow, rows: PartnerCallRow[], access: AccessContext): Promise<PartnerCallDto[]> {
  const links = new Map<string, PartnerMemberLinkRow | null>();
  const used = new Map<string, Set<PartnerScope>>();
  const out: PartnerCallDto[] = [];
  for (const c of rows) {
    if (!c.linkId) {
      out.push(await callDto(deps, p, c));
      continue;
    }
    if (!links.has(c.linkId)) links.set(c.linkId, await deps.repo.partners.getLink(c.linkId));
    const link = links.get(c.linkId)!;
    if (!hasScope(link, "calls.read")) continue;
    const withRecording = hasScope(link, "recordings.read");
    out.push(await callDto(deps, p, c, { recording: withRecording }));
    const scopes = used.get(link!.id) ?? new Set<PartnerScope>();
    scopes.add("calls.read");
    if (withRecording && c.recordingId) scopes.add("recordings.read");
    used.set(link!.id, scopes);
  }
  for (const [linkId, scopes] of used) for (const s of scopes) await logAccess(deps, links.get(linkId)!, s, access, "allowed");
  return out;
}

/** GET /v1/partner/recordings/:id: a recording of a call under a link needs that link's recordings.read. */
export async function assertRecordingAccess(deps: AppDeps, p: PartnerRow, recordingId: string, access: AccessContext) {
  const call = await deps.repo.partners.getCallByRecording(p.id, recordingId);
  if (!call?.linkId) return;
  const link = await deps.repo.partners.getLink(call.linkId);
  if (!link || link.revokedAt) throw scopeNotGranted("recordings.read");
  await assertScope(deps, link, "recordings.read", access);
}

/** GET /v1/me/partner-links/:id/access-log: the latest 50 accesses, newest first. Never a body. */
export async function accessLog(deps: AppDeps, link: PartnerMemberLinkRow): Promise<PartnerAccessLogEntryDto[]> {
  return (await deps.repo.partners.listAccessLog(link.id, PARTNER_ACCESS_LOG_LIMIT)).map((e) => ({ scope: e.scope, route: e.route, outcome: e.outcome, at: e.at.toISOString() }));
}

/** Daily job (server.ts): access log rows older than 90 days are deleted. Receipts are kept as proof of consent. */
export async function runPartnerAccessLogRetention(deps: Pick<AppDeps, "repo" | "now">): Promise<{ deleted: number }> {
  const before = new Date(deps.now().getTime() - PARTNER_ACCESS_LOG_RETENTION_DAYS * 86_400_000);
  return { deleted: await deps.repo.partners.pruneAccessLog(before) };
}

/** An upgrade request can only be opened by the person whose link it changes (preview and approve). */
export const upgradeForAnotherAccount = () =>
  new HttpError(403, "upgrade_for_another_account", "Cette demande concerne le lien d'un autre compte MIMT. Connectez-vous avec le compte relié.");
