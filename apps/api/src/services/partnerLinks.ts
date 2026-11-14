// « MIMT Connect » lot A (issue #97; docs/MIMT-CONNECT.md « Liaison de compte », « Ligne » and « Appel au nom d'un
// membre »): a partner member is tied to a real MIMT user only with that user's proof (signed in + step-up) and
// consent; the member's line is one of that user's own numbers; the partner can place click-to-call for the member.
// Routes: src/routes/partners.ts. TwiML: src/pbx/router.ts (clickToCall*), webhooks src/routes/twilioPbx.ts (c2c-*).
// Storage: src/repo/partners*.ts (0027_partner_links.sql). Everything is a no-op while PARTNERS=off.
// Consent (0029, services/partnerConsent.ts): a request names scopes with a purpose each; the person checks each one;
// every route below checks its scope on the link (403 scope_not_granted) and writes the access log.

import {
  isEmergencyNumber,
  normalizeLinkCode,
  PARTNER_LINK_CODE_ALPHABET,
  PARTNER_LINK_CODE_LENGTH,
  PARTNER_LINK_CODE_TTL_S,
  PARTNER_LINK_MAX_ATTEMPTS,
  PARTNER_CONSENT_TEXT_VERSION,
  type MyPartnerLinkDto,
  type PartnerLinkApproveRequest,
  type PartnerLinkPreview,
  type PartnerLinkRequestCreated,
  type PartnerMemberNumbersResponse,
  type PartnerScope,
  type PartnerScopeRequestItem,
} from "@mimt/shared";
import { randomInt } from "node:crypto";
import type { AppDeps } from "../deps.js";
import { exceedsDailySpend } from "../fraud/caps.js";
import { checkVoiceDestination } from "../fraud/destinations.js";
import { CALL_ATTEMPT_RULES } from "../fraud/policy.js";
import type { RateRule } from "../fraud/rateLimiter.js";
import { sha256Hex } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured } from "../lib/errors.js";
import { normalizeDialed } from "../lib/phone.js";
import { dayPeriod } from "../lib/time.js";
import { externalAllowed, pbxUrl } from "../pbx/router.js";
import type { BusinessRow } from "../repo/pbxTypes.js";
import type { PartnerLinkRequestRow, PartnerMemberLinkRow, PartnerMemberRow, PartnerRow } from "../repo/partners.js";
import { outboundBlocked } from "./accounts.js";
import { chooseNumberUrl, creditRate, emitPartnerEvent, linkLine, partnersOn, syncMemberRing } from "./partners.js";
import { myAvailability, rememberSubscriptionState } from "./partnerMembers.js";
import {
  assertScope,
  computeGrant,
  dropPartnerAvailability,
  grantOf,
  hasScope,
  receiptDto,
  recordConsent,
  upgradeForAnotherAccount,
  type AccessContext,
  type ConsentClient,
} from "./partnerConsent.js";

/** Approve/preview attempts per signed-in user and per IP address (brute force on the code). */
export const LINK_APPROVE_USER_RULE: RateRule = { capacity: 10, windowSeconds: 15 * 60 };
export const LINK_APPROVE_IP_RULE: RateRule = { capacity: 30, windowSeconds: 15 * 60 };
/** Longest click-to-call (same ceiling as business outbound calls); shortened to what the credits pay for. */
const CLICK_TO_CALL_MAX_S = 4 * 3600;

/** Random 8-character code from the no-look-alike alphabet (≈ 8.5 × 10¹¹ possibilities). */
export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < PARTNER_LINK_CODE_LENGTH; i++) code += PARTNER_LINK_CODE_ALPHABET[randomInt(PARTNER_LINK_CODE_ALPHABET.length)];
  return code;
}

const CODE_SHAPE = new RegExp(`^[${PARTNER_LINK_CODE_ALPHABET}]{${PARTNER_LINK_CODE_LENGTH}}$`);
const codeHash = (code: string) => sha256Hex(`partner-link:${code}`);

/** 409 with the « choose a number in MIMT » link, for the partner's portal. */
const needsNumber = (deps: AppDeps, p: PartnerRow, code: string, message: string) =>
  new HttpError(409, code, message, { chooseNumberUrl: chooseNumberUrl(deps, p) });

/** The member's active link, which must grant `scope` (403 scope_not_granted; the access is logged either way). */
async function activeLinkOrThrow(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, scope: PartnerScope, access: AccessContext): Promise<PartnerMemberLinkRow> {
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  if (!link) throw needsNumber(deps, p, "member_not_linked", "This member has not linked a MIMT account yet (link request, then approval in MIMT).");
  await assertScope(deps, link, scope, access);
  return link;
}

// ------------------------------------------------------------------------------------------ link requests

/**
 * POST /v1/partner/members/:externalId/link-requests: a new one-time code (any earlier pending one is invalidated) for
 * the scopes in `items` (already checked against the partner's declared purposes). When the member is already linked
 * it is an « upgrade » request: the same person approves the new scopes on /lier; until then the grant is unchanged.
 */
export async function createLinkRequest(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, items: PartnerScopeRequestItem[]): Promise<PartnerLinkRequestCreated> {
  if (!m.active) throw conflict("member_inactive", "This member is deactivated");
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  const kind = link ? "upgrade" : "link";
  const at = deps.now();
  const expiresAt = new Date(at.getTime() + PARTNER_LINK_CODE_TTL_S * 1000);
  for (let attempt = 0; ; attempt++) {
    const code = generateLinkCode();
    try {
      const row = await deps.repo.partners.createLinkRequest({ partnerId: p.id, memberId: m.id, codeSha256: codeHash(code), expiresAt, at, kind, linkId: link?.id ?? null, scopes: items });
      const base = deps.config.APP_BASE_URL.replace(/\/$/, "");
      return { requestId: row.id, kind, scopes: items, code, url: `${base}/lier?code=${code}&r=${row.id}`, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      if (attempt >= 2) throw err; // Same hash as an older code (astronomically rare): draw again.
    }
  }
}

const pending = (r: PartnerLinkRequestRow, at: Date) => !r.usedAt && !r.invalidatedAt && r.expiresAt.getTime() > at.getTime();
const expired = () => new HttpError(410, "link_code_expired", "Ce code a expiré ou a déjà servi. Demandez-en un nouveau au partenaire.");
const wrongCode = () => badRequest("invalid_link_code", "Ce code n'est pas valide. Vérifiez-le et réessayez.");

/**
 * Finds the pending request a code opens. With the request id from the link URL (`r=`), a wrong code counts against
 * that request and the 5th one kills it. Without it (code typed by hand) only the per-user and per-IP limits apply.
 */
async function resolveCode(deps: AppDeps, input: { code: string; requestId?: string | undefined }) {
  const at = deps.now();
  const code = normalizeLinkCode(input.code);
  const hash = CODE_SHAPE.test(code) ? codeHash(code) : null;
  let req: PartnerLinkRequestRow | null;
  if (input.requestId) {
    req = await deps.repo.partners.getLinkRequest(input.requestId);
    if (!req || !pending(req, at)) throw expired();
    if (hash !== req.codeSha256) {
      const after = await deps.repo.partners.recordLinkRequestFailure(req.id, PARTNER_LINK_MAX_ATTEMPTS, at);
      if (after?.invalidatedAt) throw expired();
      throw wrongCode();
    }
  } else {
    req = hash ? await deps.repo.partners.findLinkRequestByHash(hash) : null;
    if (!req) throw wrongCode();
    if (!pending(req, at)) throw expired();
  }
  const [partner, member] = await Promise.all([deps.repo.partners.getPartner(req.partnerId), deps.repo.partners.getMemberById(req.memberId)]);
  // Requests issued before named scopes (0029) carry none: they cannot be approved.
  if (!partner || partner.status !== "active" || !member || !member.active || !req.scopes.length) throw expired();
  return { req, partner, member };
}

/** The link an upgrade request changes: still active, and the signed-in person's own. */
async function upgradeTarget(deps: AppDeps, req: PartnerLinkRequestRow, userId: string): Promise<PartnerMemberLinkRow> {
  const link = req.linkId ? await deps.repo.partners.getLink(req.linkId) : null;
  if (!link || link.revokedAt) throw expired();
  if (link.userId !== userId) throw upgradeForAnotherAccount();
  return link;
}

/** Per-user and per-IP limits on code attempts (preview and approve share them). */
export async function takeLinkAttempt(deps: AppDeps, userId: string, ip: string) {
  const okUser = await deps.rateLimiter.take(`partner-link:u:${userId}`, LINK_APPROVE_USER_RULE);
  const okIp = await deps.rateLimiter.take(`partner-link:ip:${ip}`, LINK_APPROVE_IP_RULE);
  if (!okUser || !okIp) throw new HttpError(429, "rate_limited", "Trop d'essais. Réessayez dans quelques minutes.");
}

/** POST /v1/me/partner-links/preview: who asks (and its legal name and privacy contact), why, and for which scopes. */
export async function previewLink(deps: AppDeps, userId: string, input: { code: string; requestId?: string | undefined }): Promise<PartnerLinkPreview> {
  const { req, partner, member } = await resolveCode(deps, input);
  const current = req.kind === "upgrade" ? await upgradeTarget(deps, req, userId) : null;
  const terms = await deps.repo.partners.latestTermsAcceptance(partner.id);
  return {
    requestId: req.id,
    kind: req.kind,
    partnerName: partner.name,
    partnerLegalName: terms?.legalName ?? null,
    privacyContactEmail: terms?.privacyContactEmail ?? null,
    termsVersion: terms?.termsVersion ?? null,
    externalId: member.externalId,
    memberName: member.name,
    scopes: req.scopes.map((it) => ({ scope: it.scope, purpose: it.purpose, required: Boolean(it.required), granted: Boolean(current?.scopes.includes(it.scope)) })),
    currentScopes: current ? [...current.scopes] : [],
    consentVersion: PARTNER_CONSENT_TEXT_VERSION,
    expiresAt: req.expiresAt.toISOString(),
  };
}

/**
 * POST /v1/me/partner-links/approve (the caller checked step-up first). The person grants the scopes they checked:
 * only requested ones, every required one, at least one, under the consent text version they saw. Uniqueness: one
 * member per user per partner, one user per member. An upgrade request changes the existing link's grant instead.
 */
export async function approveLink(deps: AppDeps, userId: string, input: PartnerLinkApproveRequest, client: ConsentClient): Promise<MyPartnerLinkDto> {
  const { req, partner, member } = await resolveCode(deps, input);
  if (input.consentVersion !== PARTNER_CONSENT_TEXT_VERSION) {
    throw new HttpError(409, "consent_text_changed", "Le texte du consentement a changé. Relisez-le, puis autorisez à nouveau.", { consentVersion: PARTNER_CONSENT_TEXT_VERSION });
  }
  if (req.kind === "upgrade") return approveUpgrade(deps, userId, req, await upgradeTarget(deps, req, userId), partner, member, input.scopes, client);
  const [byMember, byUser] = await Promise.all([
    deps.repo.partners.getActiveLinkByMember(member.id),
    deps.repo.partners.getActiveLinkByUser(partner.id, userId),
  ]);
  // Linked meanwhile by this same person (two tabs): the choice applies to that link, as an upgrade would.
  if (byMember && byMember.userId === userId) return approveUpgrade(deps, userId, req, byMember, partner, member, input.scopes, client);
  if (byMember) throw conflict("member_already_linked", "Ce profil est déjà relié à un autre compte MIMT.");
  if (byUser) throw conflict("already_linked_to_partner", "Votre compte MIMT est déjà relié à un autre profil de ce partenaire. Retirez ce lien d'abord.");
  // Validate the choice before the code is spent: a mistake on the screen must not burn it.
  const { grant, changed } = computeGrant(null, req, input.scopes);
  const at = deps.now();
  if (!(await deps.repo.partners.consumeLinkRequest(req.id, at))) throw expired();
  const res = await deps.repo.partners.createLink({ partnerId: partner.id, memberId: member.id, userId, requestId: req.id, at, grant });
  if (res.status === "member_taken") throw conflict("member_already_linked", "Ce profil est déjà relié à un autre compte MIMT.");
  if (res.status === "user_taken") throw conflict("already_linked_to_partner", "Votre compte MIMT est déjà relié à un autre profil de ce partenaire.");
  await syncMemberRing(deps, partner, member);
  // Lot B: the plan status at approval is the baseline; member.subscription_changed reports what changes after.
  await rememberSubscriptionState(deps, res.link);
  if (!hasScope(res.link, "availability.manage")) await dropPartnerAvailability(deps, res.link);
  await emitPartnerEvent(deps, partner, "member.linked", { member_external_id: member.externalId, scopes: [...grant.scopes], linked_at: at.toISOString() }, { linkId: res.link.id });
  await recordConsent(deps, { partner, member, link: res.link, action: "granted", actor: "user", changed, client });
  await deps.repo.audit({
    actorUserId: userId,
    action: "partner.member_linked",
    targetType: "partner",
    targetId: partner.id,
    ip: client.ip,
    meta: { linkId: res.link.id, memberId: member.id, requestId: req.id, scopes: grant.scopes, consentVersion: grant.consentVersion },
  });
  return myLinkDto(deps, res.link);
}

/** The person approves an upgrade (or a change) of their link's scopes; scopes not in the request stay as they were. */
async function approveUpgrade(
  deps: AppDeps,
  userId: string,
  req: PartnerLinkRequestRow,
  link: PartnerMemberLinkRow,
  partner: PartnerRow,
  member: PartnerMemberRow,
  chosen: PartnerScope[],
  client: ConsentClient,
): Promise<MyPartnerLinkDto> {
  const { grant, changed } = computeGrant(grantOf(link), req, chosen);
  const at = deps.now();
  if (!(await deps.repo.partners.consumeLinkRequest(req.id, at))) throw expired();
  const updated = await deps.repo.partners.setLinkGrant(link.id, grant, at);
  if (!updated) throw expired();
  if (!hasScope(updated, "availability.manage")) await dropPartnerAvailability(deps, updated);
  await recordConsent(deps, { partner, member, link: updated, action: "upgraded", actor: "user", changed, client });
  await deps.repo.audit({
    actorUserId: userId,
    action: "partner.consent_upgraded",
    targetType: "partner",
    targetId: partner.id,
    ip: client.ip,
    meta: { linkId: link.id, memberId: member.id, requestId: req.id, scopes: grant.scopes, changed, consentVersion: grant.consentVersion },
  });
  return myLinkDto(deps, updated);
}

/**
 * DELETE /v1/me/partner-links/:id/scopes/:scope: the person removes one access at once (no step-up: it only takes
 * access away). Removing the last one unlinks. A required scope may be removed too; the partner is told and decides.
 */
export async function revokeScope(deps: AppDeps, link: PartnerMemberLinkRow, scope: PartnerScope, client: ConsentClient & { userId: string }) {
  if (!link.scopes.includes(scope)) throw new HttpError(404, "scope_not_granted", "Cet accès n'est pas accordé.", { scope });
  const remaining = link.scopes.filter((s) => s !== scope);
  if (!remaining.length) {
    await revokeLink(deps, link, { side: "user", actorUserId: client.userId, ip: client.ip, userAgent: client.userAgent });
    return { unlinked: true, link: null };
  }
  const [partner, member] = await Promise.all([deps.repo.partners.getPartner(link.partnerId), deps.repo.partners.getMemberById(link.memberId)]);
  const purposes = { ...link.purposes };
  delete purposes[scope];
  const updated = await deps.repo.partners.setLinkGrant(
    link.id,
    { ...grantOf(link), scopes: remaining, requiredScopes: link.requiredScopes.filter((s) => s !== scope), purposes },
    deps.now(),
  );
  if (!updated) throw new HttpError(404, "link_not_found", "Lien introuvable.");
  if (scope === "availability.manage") await dropPartnerAvailability(deps, updated);
  if (partner && member) await recordConsent(deps, { partner, member, link: updated, action: "scope_revoked", actor: "user", changed: [scope], client });
  await deps.repo.audit({
    actorUserId: client.userId,
    action: "partner.scope_revoked",
    targetType: "partner",
    targetId: link.partnerId,
    ip: client.ip,
    meta: { linkId: link.id, scope, remaining },
  });
  return { unlinked: false, link: await myLinkDto(deps, updated) };
}

export async function myLinkDto(deps: AppDeps, link: PartnerMemberLinkRow): Promise<MyPartnerLinkDto> {
  const [partner, member, line, availability, terms, receipts] = await Promise.all([
    deps.repo.partners.getPartner(link.partnerId),
    deps.repo.partners.getMemberById(link.memberId),
    linkLine(deps, link),
    myAvailability(deps, link),
    deps.repo.partners.latestTermsAcceptance(link.partnerId),
    deps.repo.partners.listConsentReceipts(link.id, 1),
  ]);
  return {
    id: link.id,
    partnerName: partner?.name ?? "",
    partnerLegalName: terms?.legalName ?? null,
    privacyContactEmail: terms?.privacyContactEmail ?? null,
    externalId: member?.externalId ?? "",
    memberName: member?.name ?? "",
    lineNumber: line?.e164 ?? null,
    scopes: [...link.scopes],
    requiredScopes: [...link.requiredScopes],
    purposes: { ...link.purposes },
    consentVersion: link.consentVersion,
    consentCurrent: link.consentVersion === PARTNER_CONSENT_TEXT_VERSION,
    consentedAt: link.consentedAt.toISOString(),
    receipt: receipts[0] ? receiptDto(receipts[0]) : null,
    userStatus: availability.userStatus,
    effectiveStatus: availability.effectiveStatus,
    createdAt: link.createdAt.toISOString(),
  };
}

/** Revocation from either side: the member's apps stop ringing for the partner, member.unlinked goes out. */
export async function revokeLink(
  deps: AppDeps,
  link: PartnerMemberLinkRow,
  by: { side: "user" | "partner"; actorUserId: string | null; ip?: string; keyId?: string; userAgent?: unknown },
) {
  const at = deps.now();
  const revoked = await deps.repo.partners.revokeLink(link.id, by.side, at);
  if (!revoked) return null;
  const [partner, member] = await Promise.all([deps.repo.partners.getPartner(link.partnerId), deps.repo.partners.getMemberById(link.memberId)]);
  if (partner && member) {
    await syncMemberRing(deps, partner, member);
    await emitPartnerEvent(deps, partner, "member.unlinked", { member_external_id: member.externalId, by: by.side, unlinked_at: at.toISOString() }, { linkId: link.id });
    // Receipt of the withdrawal (the person's device only when they did it themselves).
    const client = by.side === "user" && by.ip ? { ip: by.ip, userAgent: by.userAgent } : undefined;
    await recordConsent(deps, { partner, member, link: revoked, action: "revoked", actor: by.side, changed: [...link.scopes], client });
  }
  await deps.repo.audit({
    actorUserId: by.actorUserId,
    action: "partner.member_unlinked",
    targetType: "partner",
    targetId: link.partnerId,
    ip: by.ip ?? null,
    meta: { linkId: link.id, memberId: link.memberId, by: by.side, ...(by.keyId ? { keyId: by.keyId } : {}) },
  });
  return revoked;
}

// ---------------------------------------------------------------------------------------------- the line

/** GET /v1/partner/members/:externalId/numbers: the linked user's ACTIVE MIMT numbers. */
export async function memberNumbers(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, access: AccessContext): Promise<PartnerMemberNumbersResponse> {
  const link = await activeLinkOrThrow(deps, p, m, "line.manage", access);
  return numbersOf(deps, p, link);
}

async function numbersOf(deps: AppDeps, p: PartnerRow, link: PartnerMemberLinkRow): Promise<PartnerMemberNumbersResponse> {
  const account = await deps.repo.getAccountByOwner(link.userId);
  const numbers = account ? (await deps.repo.listNumbersByAccount(account.id)).filter((n) => n.state === "active") : [];
  const current = await linkLine(deps, link);
  return { numbers: numbers.map((n) => ({ e164: n.e164 })), current: current?.e164 ?? null, chooseNumberUrl: current ? null : chooseNumberUrl(deps, p) };
}

/**
 * PUT /v1/partner/members/:externalId/number: attaches one of THE LINKED USER'S OWN active numbers as the member's
 * line (null detaches). Anything else is refused: MIMT never buys or lends a number on the partner's say-so.
 */
export async function setMemberNumber(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, e164: string | null, actor: { ip: string; keyId: string } & AccessContext) {
  const link = await activeLinkOrThrow(deps, p, m, "line.manage", actor);
  let numberId: string | null = null;
  if (e164) {
    const [n, account] = await Promise.all([deps.repo.getNumberByE164(e164), deps.repo.getAccountByOwner(link.userId)]);
    if (!n || !account || n.telecomAccountId !== account.id || n.state !== "active") {
      throw new HttpError(403, "number_not_owned", "This number is not one of the linked person's active MIMT numbers", { chooseNumberUrl: chooseNumberUrl(deps, p) });
    }
    numberId = n.id;
  }
  const changed = link.numberId !== numberId;
  const updated = (await deps.repo.partners.setLinkNumber(link.id, numberId)) ?? link;
  if (changed) {
    await emitPartnerEvent(deps, p, "member.number_changed", { member_external_id: m.externalId, number: e164 }, { linkId: link.id });
    await deps.repo.audit({
      actorUserId: null,
      action: "partner.member_number_set",
      targetType: "partner",
      targetId: p.id,
      ip: actor.ip,
      meta: { keyId: actor.keyId, linkId: link.id, memberId: m.id, numberId },
    });
  }
  return numbersOf(deps, p, updated);
}

// ------------------------------------------------------------------------------------------ click-to-call

/** N11 service codes (2-1-1 … 9-1-1) as dialed, or as an area code or exchange of a NANP number. */
const isN11 = (raw: string, e164: string | null) => {
  const digits = raw.replace(/[^\d]/g, "");
  if (/^1?[2-9]11$/.test(digits)) return true;
  return Boolean(e164 && /^\+1([2-9]11|\d{3}[2-9]11)/.test(e164));
};

/**
 * POST /v1/partner/members/:externalId/calls. MIMT rings the member first (their MIMT apps, or their cellphone with
 * the press-1 whisper), and only when they accept dials `to` with their line as caller ID. Guards, in order:
 * active member + link + line; destination (Canada/US only, never 9-1-1, N11, 900/976 or high-cost NANP); per-member
 * attempt limits and one call at a time; the accounts' outbound status and daily spend guard; partner credits (402).
 * Billing: partner credits per started minute of conversation with `to`, like hunt-group calls; the member's own plan
 * minutes are not touched.
 */
export async function clickToCall(
  deps: AppDeps,
  ctx: { partner: PartnerRow; business: BusinessRow; keyId: string; ip: string } & AccessContext,
  m: PartnerMemberRow,
  body: { to: string; reference?: string | undefined; via?: "app" | "mobile" | undefined },
): Promise<{ callId: string }> {
  const { partner: p, business } = ctx;
  if (!m.active) throw conflict("member_inactive", "This member is deactivated");
  const link = await activeLinkOrThrow(deps, p, m, "calls.place", ctx);
  const line = await linkLine(deps, link);
  if (!line) throw needsNumber(deps, p, "member_number_required", "Attach one of the member's MIMT numbers first (PUT …/number).");

  const to = normalizeDialed(body.to);
  if (isEmergencyNumber(body.to) || isN11(body.to, to)) throw badRequest("destination_not_allowed", "9-1-1 and N11 service codes cannot be dialed for a member");
  if (!to) throw badRequest("invalid_number", "`to` must be a Canada/US phone number");
  const dest = checkVoiceDestination(to, { entitled: false, creditCents: 0 });
  if (!dest.ok) {
    if (dest.reason !== "invalid_number") {
      await deps.repo.addFraudEvent({ telecomAccountId: business.telecomAccountId, rule: `partner_c2c_${dest.reason}`, score: 50, action: "block", details: { memberId: m.id, zone: dest.zone } });
    }
    throw badRequest(dest.reason === "invalid_number" ? "invalid_number" : "destination_not_allowed", "Only Canada/US numbers, never premium-rate or high-cost NANP codes");
  }

  // Per-member attempt limits (same rules as a person dialing in the apps).
  const okMinute = await deps.rateLimiter.take(`partner:c2c:m:${m.id}`, CALL_ATTEMPT_RULES.minute);
  const okHour = okMinute && (await deps.rateLimiter.take(`partner:c2c:h:${m.id}`, CALL_ATTEMPT_RULES.hour));
  if (!okHour) {
    await deps.repo.addFraudEvent({ telecomAccountId: business.telecomAccountId, rule: "partner_c2c_rate", score: 50, action: "block", details: { memberId: m.id } });
    throw new HttpError(429, "rate_limited", "Too many calls for this member; try again later.");
  }
  const now = deps.now();
  if ((await deps.repo.partners.countOpenOutboundCalls(m.id, new Date(now.getTime() - CLICK_TO_CALL_MAX_S * 1000))) > 0) {
    throw conflict("call_in_progress", "This member already has a click-to-call in progress");
  }

  // The member's account and the partner's business account must both be allowed to place calls.
  const [memberAccount, businessAccount] = await Promise.all([deps.repo.getAccount(line.telecomAccountId!), deps.repo.getAccount(business.telecomAccountId)]);
  if (!memberAccount || !businessAccount || outboundBlocked(memberAccount) || outboundBlocked(businessAccount)) {
    throw forbidden("account_restricted", "Outgoing calls are suspended on this account");
  }
  for (const account of [memberAccount, businessAccount]) {
    const today = await deps.repo.getUsage(account.id, dayPeriod(now));
    if (exceedsDailySpend(today.spendCad, deps.config.DAILY_SPEND_ALERT_CAD)) throw forbidden("account_restricted", "Outgoing calls are paused (daily spend guard)");
  }

  // Credits: nobody is waiting on the line, so a call the partner cannot pay for is refused up front.
  const partner = (await deps.repo.partners.getPartner(p.id))!;
  const rate = creditRate(deps, partner);
  if (rate > 0 && partner.creditBalance < rate) throw new HttpError(402, "insufficient_credits", "No credits left for click-to-call; top up first");
  const timeLimit = rate > 0 ? Math.min(Math.floor(partner.creditBalance / rate) * 60, CLICK_TO_CALL_MAX_S) : CLICK_TO_CALL_MAX_S;

  const via = body.via ?? "app";
  if (via === "mobile" && !(m.phone && externalAllowed(m.phone))) throw badRequest("no_mobile", "This member has no cellphone to ring");
  if (!deps.twilio?.createCall) throw notConfigured("Voice");

  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  // Everything the TwiML steps need is in the (signed) URL: the call is placed before its row can exist.
  const step = { b: business.id, to, cid: line.e164, tl: timeLimit, w: via === "mobile" ? 1 : 0 };
  const placed = await deps.twilio.createCall({
    to: via === "mobile" ? m.phone! : `client:${link.userId}`,
    from: line.e164,
    url: pbxUrl(base, "c2c-answer", step),
    statusCallback: pbxUrl(base, "c2c-status", { b: business.id }),
  });
  const call = await deps.repo.partners.createCall({
    partnerId: p.id,
    callSid: placed.sid,
    direction: "outbound",
    fromNumber: line.e164,
    toNumber: to,
    huntGroupKey: null,
    startedAt: now,
    memberId: m.id,
    externalId: m.externalId,
    reference: body.reference ?? null,
    linkId: link.id,
  });
  // Placed with calls.place; its events and its record are sent and shown only with calls.read.
  await emitPartnerEvent(
    deps,
    p,
    "call.ringing",
    {
      call_id: call.id,
      direction: "outbound",
      member_external_id: m.externalId,
      reference: call.reference,
      hunt_group: null,
      from: call.fromNumber,
      to: call.toNumber,
      started_at: call.startedAt.toISOString(),
    },
    { linkId: link.id },
  );
  await deps.repo.audit({
    actorUserId: null,
    action: "partner.click_to_call",
    targetType: "partner",
    targetId: p.id,
    ip: ctx.ip,
    meta: { keyId: ctx.keyId, callId: call.id, memberId: m.id, linkId: link.id, via },
  });
  return { callId: call.id };
}

/** The called party (`to`) answered a click-to-call: call.answered for the member (first answer only). */
export async function partnerOutboundAnswered(deps: AppDeps, input: { parentCallSid: string; legSid: string }) {
  if (!partnersOn(deps)) return;
  const call = await deps.repo.partners.getCallBySid(input.parentCallSid);
  if (!call || call.direction !== "outbound" || !call.memberId || !call.externalId || call.finalizedAt) return;
  const answered = await deps.repo.partners.markAnswered(call.id, { memberId: call.memberId, externalId: call.externalId, legSid: input.legSid, at: deps.now() });
  const p = answered ? await deps.repo.partners.getPartner(call.partnerId) : null;
  if (!p || !answered) return;
  await emitPartnerEvent(
    deps,
    p,
    "call.answered",
    {
      call_id: call.id,
      direction: "outbound",
      member_external_id: call.externalId,
      reference: call.reference,
      hunt_group: null,
      answered_at: answered.answeredAt!.toISOString(),
    },
    { linkId: call.linkId },
  );
}

/** The user's own view (Compte › Intégrations › Partenaires): every active link, so each one can be revoked. */
export async function listMyLinks(deps: AppDeps, userId: string): Promise<MyPartnerLinkDto[]> {
  return Promise.all((await deps.repo.partners.listActiveLinksByUser(userId)).map((l) => myLinkDto(deps, l)));
}
