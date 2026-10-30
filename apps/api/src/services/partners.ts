// « MIMT Connect » partner platform (docs/MIMT-CONNECT.md): API keys, members ↔ extensions, hunt groups ↔ ring
// groups, the credit ledger, the PBX call hooks and the signed webhook outbox. Routes: src/routes/partners.ts.
// Storage: src/repo/partners*.ts (0023_partners.sql). Everything is a no-op while PARTNERS=off.

import {
  isValidExtension,
  normalizeHandle,
  type PartnerApiKeyCreated,
  type PartnerApiKeyDto,
  type PartnerCallDto,
  type PartnerDto,
  type PartnerEventType,
  type PartnerHuntGroupDto,
  type PartnerHuntGroupRequest,
  type PartnerLedgerEntryDto,
  type PartnerMemberDto,
  type PartnerMemberRequest,
  type PartnerWebhookResponse,
  type RouteTarget,
} from "@mimt/shared";
import { isIP } from "node:net";
import type { AppDeps } from "../deps.js";
import { badRequest, conflict, forbidden, HttpError, unauthorized } from "../lib/errors.js";
import { randomToken, sha256Hex, signWebhook } from "../lib/crypto.js";
import { externalAllowed, isOpen } from "../pbx/router.js";
import type { BusinessRow, RecordingRow } from "../repo/pbxTypes.js";
import type { PartnerApiKeyRow, PartnerCallRow, PartnerLedgerRow, PartnerMemberLinkRow, PartnerMemberRow, PartnerRow } from "../repo/partners.js";
import type { PhoneNumber } from "../repo/types.js";
import { RECORDING_URL_TTL_S, recordingResource } from "../routes/business.js";
import { getFeatures, HELD_STATES } from "./accounts.js";

type Log = { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

/** Partner API keys start with this, so a leaked key is easy to recognize (and to scan for). */
export const PARTNER_KEY_PREFIX = "mimt_pk_";
/** Characters of the key kept in clear to recognize it in a list. */
const DISPLAY_PREFIX_LENGTH = 14;
/** Active keys per partner: enough for a rotation with overlap, few enough to keep track of. */
export const MAX_ACTIVE_KEYS = 5;
/** Requests per key per minute on /v1/partner/*. */
export const PARTNER_RATE_RULE = { capacity: 120, windowSeconds: 60 };
/** Extension numbers given to partner members (outside the 1xx range people pick by hand). */
const MEMBER_EXTENSION_FIRST = 2000;
const MEMBER_EXTENSION_LAST = 8999;
/** Webhook outbox: exponential backoff 30 s → 4 h, dead after 10 attempts. */
export const WEBHOOK_MAX_ATTEMPTS = 10;
const WEBHOOK_TIMEOUT_MS = 10_000;

export const partnersOn = (deps: Pick<AppDeps, "config">) => deps.config.PARTNERS === "on";

/** Credits per started minute for this partner (its own rate, else PARTNER_CREDIT_PER_MINUTE). */
export const creditRate = (deps: Pick<AppDeps, "config">, p: PartnerRow) => p.creditPerMinute ?? deps.config.PARTNER_CREDIT_PER_MINUTE;

/** The partner of a business, when the platform is on and the partner active. Null otherwise (no hook runs). */
export async function activePartner(deps: AppDeps, businessId: string): Promise<PartnerRow | null> {
  if (!partnersOn(deps)) return null;
  const p = await deps.repo.partners.getPartnerByBusiness(businessId);
  return p?.status === "active" ? p : null;
}

// ------------------------------------------------------------------------------------------- DTOs

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const partnerDto = (deps: Pick<AppDeps, "config">, p: PartnerRow): PartnerDto => ({
  id: p.id,
  businessId: p.businessId,
  name: p.name,
  status: p.status,
  creditPerMinute: creditRate(deps, p),
  balance: p.creditBalance,
  webhookUrl: p.webhookUrl,
  createdAt: p.createdAt.toISOString(),
});

export const apiKeyDto = (k: PartnerApiKeyRow): PartnerApiKeyDto => ({
  id: k.id,
  prefix: k.prefix,
  label: k.label,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: iso(k.lastUsedAt),
  revokedAt: iso(k.revokedAt),
});

export const ledgerDto = (l: PartnerLedgerRow): PartnerLedgerEntryDto => ({
  id: l.id,
  delta: l.delta,
  reason: l.reason,
  reference: l.reference,
  balanceAfter: l.balanceAfter,
  createdAt: l.createdAt.toISOString(),
});

/** Where a member chooses and pays for a number in MIMT (MIMT never buys one on the partner's say-so). */
export const chooseNumberUrl = (deps: Pick<AppDeps, "config">, p: PartnerRow) =>
  `${deps.config.APP_BASE_URL.replace(/\/$/, "")}/numero?partner=${encodeURIComponent(p.slug ?? p.id)}`;

/**
 * The member's line: the attached number, only while it is still one of the linked user's own ACTIVE numbers
 * (checked on every read, so a number given up or moved stops being used as caller ID at once).
 */
export async function linkLine(deps: AppDeps, link: PartnerMemberLinkRow | null): Promise<PhoneNumber | null> {
  if (!link?.numberId) return null;
  const [n, account] = await Promise.all([deps.repo.getNumber(link.numberId), deps.repo.getAccountByOwner(link.userId)]);
  return n && account && n.telecomAccountId === account.id && n.state === "active" ? n : null;
}

export async function memberDto(deps: AppDeps, m: PartnerMemberRow): Promise<PartnerMemberDto> {
  const ext = m.extensionId ? await deps.repo.pbx.getExtension(m.extensionId) : null;
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  const line = await linkLine(deps, link);
  const partner = line ? null : await deps.repo.partners.getPartner(m.partnerId);
  return {
    externalId: m.externalId,
    name: m.name,
    email: m.email,
    phone: m.phone,
    handle: m.handle,
    language: m.language,
    active: m.active,
    extension: ext?.number ?? null,
    linked: Boolean(link),
    lineNumber: line?.e164 ?? null,
    chooseNumberUrl: partner ? chooseNumberUrl(deps, partner) : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** Short-lived signed URL through our API (the business recording route), never the Twilio URL. */
export async function recordingLink(deps: AppDeps, businessId: string, recordingId: string) {
  const rec = await deps.repo.pbx.getRecording(recordingId);
  if (!rec || rec.businessId !== businessId) return null;
  const signed = await deps.sessions.signMedia(recordingResource(rec.id), RECORDING_URL_TTL_S);
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  return {
    url: `${base}/v1/business/${businessId}/recordings/${rec.id}/audio?token=${encodeURIComponent(signed.token)}`,
    expiresAt: signed.expiresAt.toISOString(),
  };
}

export async function callDto(deps: AppDeps, p: PartnerRow, c: PartnerCallRow): Promise<PartnerCallDto> {
  const link = c.recordingId ? await recordingLink(deps, p.businessId, c.recordingId) : null;
  return {
    id: c.id,
    direction: c.direction,
    reference: c.reference,
    huntGroup: c.huntGroupKey,
    externalId: c.externalId,
    from: c.fromNumber,
    to: c.toNumber,
    startedAt: c.startedAt.toISOString(),
    answeredAt: iso(c.answeredAt),
    endedAt: iso(c.endedAt),
    durationS: c.talkS ?? 0,
    credits: c.creditsCharged,
    billing: c.billing,
    recordingUrl: link?.url ?? null,
    recordingUrlExpiresAt: link?.expiresAt ?? null,
  };
}

// --------------------------------------------------------------------------------------- API keys

/** New key: `mimt_pk_` + 32 random bytes. Only its SHA-256 and first characters are stored. */
export function generatePartnerKey() {
  const key = PARTNER_KEY_PREFIX + randomToken(32);
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), keySha256: sha256Hex(key) };
}

export async function issueApiKey(deps: AppDeps, p: PartnerRow, opts: { label: string | null; actorUserId: string | null; ip?: string }): Promise<PartnerApiKeyCreated> {
  const active = (await deps.repo.partners.listApiKeys(p.id)).filter((k) => !k.revokedAt);
  if (active.length >= MAX_ACTIVE_KEYS) throw conflict("too_many_keys", `Au plus ${MAX_ACTIVE_KEYS} clés actives : révoquez-en une d'abord.`);
  const g = generatePartnerKey();
  const row = await deps.repo.partners.createApiKey({ partnerId: p.id, prefix: g.prefix, keySha256: g.keySha256, label: opts.label, createdBy: opts.actorUserId });
  await deps.repo.audit({ actorUserId: opts.actorUserId, action: "partner.key_created", targetType: "partner", targetId: p.id, ip: opts.ip ?? null, meta: { keyId: row.id, prefix: row.prefix } });
  return { key: g.key, apiKey: apiKeyDto(row) };
}

export async function revokeApiKey(deps: AppDeps, p: PartnerRow, keyId: string, opts: { actorUserId: string | null; ip?: string }) {
  const row = await deps.repo.partners.revokeApiKey(p.id, keyId, deps.now());
  if (!row) return null;
  await deps.repo.audit({ actorUserId: opts.actorUserId, action: "partner.key_revoked", targetType: "partner", targetId: p.id, ip: opts.ip ?? null, meta: { keyId, prefix: row.prefix } });
  return row;
}

/** Rotation: a new key, and the old one revoked at once (create a second key first for an overlap). */
export async function rotateApiKey(deps: AppDeps, p: PartnerRow, keyId: string, opts: { actorUserId: string | null; ip?: string }) {
  const old = (await deps.repo.partners.listApiKeys(p.id)).find((k) => k.id === keyId && !k.revokedAt);
  if (!old) return null;
  await revokeApiKey(deps, p, keyId, opts);
  return issueApiKey(deps, p, { label: old.label, ...opts });
}

/** `Authorization: Bearer mimt_pk_…` → the key's partner and business. 401 for anything else. */
export async function authenticatePartnerKey(deps: AppDeps, header: string | undefined) {
  const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw.startsWith(PARTNER_KEY_PREFIX) || raw.length > 200) throw unauthorized("Invalid or missing partner API key");
  const key = await deps.repo.partners.findApiKeyByHash(sha256Hex(raw));
  if (!key || key.revokedAt) throw new HttpError(401, "invalid_api_key", "Invalid or revoked partner API key");
  const partner = await deps.repo.partners.getPartner(key.partnerId);
  const business = partner ? await deps.repo.pbx.getBusiness(partner.businessId) : null;
  if (!partner || !business) throw new HttpError(401, "invalid_api_key", "Invalid or revoked partner API key");
  if (partner.status !== "active") throw forbidden("partner_suspended", "This partner is suspended");
  await deps.repo.partners.touchApiKey(key.id, deps.now());
  return { partner, key, business };
}

// ---------------------------------------------------------------------------------------- webhook

/**
 * Webhook targets: https only, no credentials in the URL, and no local or IP-literal host (the API must not be
 * turned into a probe of private networks). DNS is not resolved here; redirects are refused at delivery.
 */
export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (u.protocol !== "https:") return "https_required";
  if (u.username || u.password) return "credentials_in_url";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) || host === "localhost" || !host.includes(".") || /\.(local|localhost|internal|lan|home|corp)$/.test(host)) return "host_not_allowed";
  return null;
}

export async function setWebhook(
  deps: AppDeps,
  p: PartnerRow,
  input: { url: string | null; rotateSecret?: boolean },
  opts: { actorUserId: string | null; ip?: string },
): Promise<PartnerWebhookResponse> {
  if (input.url) {
    const problem = webhookUrlProblem(input.url);
    if (problem) throw badRequest(problem, "L'adresse du webhook doit être une URL https publique.");
  }
  // A secret is created with the first URL and on request; it is returned only then.
  const newSecret = input.url && (!p.webhookSecretEncrypted || input.rotateSecret) ? `whsec_${randomToken(32)}` : null;
  await deps.repo.partners.updatePartner(p.id, {
    webhookUrl: input.url,
    ...(newSecret ? { webhookSecretEncrypted: deps.cipher.encrypt(newSecret) } : {}),
  });
  await deps.repo.audit({
    actorUserId: opts.actorUserId,
    action: "partner.webhook_set",
    targetType: "partner",
    targetId: p.id,
    ip: opts.ip ?? null,
    meta: { host: input.url ? new URL(input.url).host : null, secretRotated: Boolean(newSecret) },
  });
  return { webhookUrl: input.url, secret: newSecret };
}

/** Queues an event for the partner's webhook (nothing when no webhook is set). Payload: ids and metadata only. */
export async function emitPartnerEvent(deps: AppDeps, p: PartnerRow, eventType: PartnerEventType, data: Record<string, unknown>) {
  if (!p.webhookUrl) return null;
  return deps.repo.partners.enqueueEvent({ partnerId: p.id, eventType, payload: { partner_id: p.id, ...data }, at: deps.now() });
}

/**
 * Delivers due webhook events (server.ts timer, same model as services/outbox.ts). Body: `{ id, type, created_at,
 * data }`; header X-MIMT-Signature `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` with the partner's secret.
 * A 2xx is delivered; anything else (redirects included) is retried with backoff, dead after 10 attempts.
 */
export async function deliverPartnerWebhooks(deps: AppDeps, log: Log, opts: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  if (!partnersOn(deps)) return { delivered: 0, failed: 0 };
  const now = opts.now ?? deps.now();
  const doFetch = opts.fetchImpl ?? fetch;
  const partners = new Map<string, PartnerRow | null>();
  let delivered = 0;
  let failed = 0;
  for (const ev of await deps.repo.partners.listDueEvents(now, 50)) {
    if (!partners.has(ev.partnerId)) partners.set(ev.partnerId, await deps.repo.partners.getPartner(ev.partnerId));
    const p = partners.get(ev.partnerId);
    if (!p?.webhookUrl || !p.webhookSecretEncrypted || webhookUrlProblem(p.webhookUrl)) {
      // The webhook was removed after the event was queued: nothing to send to, ever.
      await deps.repo.partners.markEventFailed(ev.id, "no webhook configured", null);
      continue;
    }
    const body = JSON.stringify({ id: ev.id, type: ev.eventType, created_at: ev.createdAt.toISOString(), data: ev.payload });
    try {
      const signature = signWebhook(deps.cipher.decrypt(p.webhookSecretEncrypted), body, Math.floor(now.getTime() / 1000));
      const res = await doFetch(p.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "MIMT-Connect/1",
          "x-mimt-signature": signature,
          "x-mimt-event": ev.eventType,
          "x-mimt-delivery": ev.id,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      await deps.repo.partners.markEventDelivered(ev.id, deps.now());
      delivered++;
    } catch (err) {
      failed++;
      const attempts = ev.attempts + 1;
      const next = attempts >= WEBHOOK_MAX_ATTEMPTS ? null : new Date(now.getTime() + Math.min(30_000 * 2 ** ev.attempts, 4 * 3600_000));
      await deps.repo.partners.markEventFailed(ev.id, String(err instanceof Error ? err.message : err), next);
      log.warn({ eventId: ev.id, partnerId: ev.partnerId, type: ev.eventType, attempts, dead: next === null }, "partner webhook delivery failed");
    }
  }
  return { delivered, failed };
}

// ---------------------------------------------------------------------------------------- members

/** First free extension number for a member (shared dial plan with ring groups). */
async function freeExtensionNumber(deps: AppDeps, businessId: string): Promise<string> {
  const [exts, groups] = await Promise.all([deps.repo.pbx.listExtensions(businessId), deps.repo.pbx.listRingGroups(businessId)]);
  const taken = new Set([...exts.map((e) => e.number), ...groups.map((g) => g.number).filter(Boolean)]);
  for (let n = MEMBER_EXTENSION_FIRST; n <= MEMBER_EXTENSION_LAST; n++) {
    const s = String(n);
    if (!taken.has(s) && isValidExtension(s)) return s;
  }
  throw conflict("no_extension_left", "No extension number is left for this business");
}

/** The MIMT user behind an @handle, who must be an active member of the business (so a partner can't ring strangers). */
async function handleUser(deps: AppDeps, business: BusinessRow, raw: string | null | undefined): Promise<{ handle: string; userId: string } | null> {
  if (!raw) return null;
  const handle = normalizeHandle(raw);
  const row = handle ? await deps.repo.handles.find(handle) : null;
  if (!handle || !row) throw badRequest("unknown_handle", "Unknown MIMT handle");
  if (!(await deps.repo.pbx.getMembership(business.id, row.userId))) {
    throw badRequest("handle_not_member", "The MIMT user must first join the business (invitation from the owner)");
  }
  return { handle, userId: row.userId };
}

/**
 * Whose MIMT apps ring for a member: the user who approved the account link (consent replaces the business
 * membership needed for an @handle), else the @handle's user. Null when neither.
 */
export async function memberRingUser(deps: AppDeps, business: BusinessRow, m: Pick<PartnerMemberRow, "id" | "handle">): Promise<string | null> {
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  if (link) return link.userId;
  try {
    return (await handleUser(deps, business, m.handle))?.userId ?? null;
  } catch {
    return null; // The @handle's user left the business since: nobody's apps ring.
  }
}

/** Points the member's extension at its ring user again (after a link or an unlink). The mobile stays as it is. */
export async function syncMemberRing(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow) {
  if (!m.active || !m.extensionId) return;
  const business = await deps.repo.pbx.getBusiness(p.businessId);
  const ext = await deps.repo.pbx.getExtension(m.extensionId);
  if (!business || !ext || ext.businessId !== business.id) return;
  await deps.repo.pbx.updateExtension(ext.id, { userId: await memberRingUser(deps, business, m) });
}

/**
 * PUT /v1/partner/members/:externalId. Idempotent: the same body twice changes nothing and keeps the same
 * extension. An inactive member keeps their extension, but it rings nobody (removed from every hunt).
 */
export async function upsertMember(deps: AppDeps, p: PartnerRow, business: BusinessRow, externalId: string, body: PartnerMemberRequest) {
  if (body.phone && !externalAllowed(body.phone)) throw badRequest("phone_not_allowed", "Only Canada/US non-premium numbers can be rung");
  const user = await handleUser(deps, business, body.handle);
  const active = body.active ?? true;
  const existing = await deps.repo.partners.getMember(p.id, externalId);
  // A linked member rings the apps of the user who approved the link, whatever the @handle says.
  const link = existing ? await deps.repo.partners.getActiveLinkByMember(existing.id) : null;
  const extFields = {
    displayName: body.name.slice(0, 80),
    userId: active ? (link?.userId ?? user?.userId ?? null) : null,
    forwardToMobile: active ? (body.phone ?? null) : null,
  };
  let ext = existing?.extensionId ? await deps.repo.pbx.getExtension(existing.extensionId) : null;
  if (ext && ext.businessId === business.id) {
    ext = await deps.repo.pbx.updateExtension(ext.id, extFields);
  } else {
    // Two members created at once can race for a number: the unique index refuses one, so try again.
    for (let attempt = 0; ; attempt++) {
      try {
        ext = await deps.repo.pbx.createExtension({
          businessId: business.id,
          number: await freeExtensionNumber(deps, business.id),
          ...extFields,
          voicemail: { enabled: true, greeting: null },
          did: null,
          ringTimeoutS: 25,
        });
        break;
      } catch (err) {
        if (attempt >= 2 || err instanceof HttpError) throw err;
      }
    }
  }
  return deps.repo.partners.upsertMember(p.id, externalId, {
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    handle: user?.handle ?? null,
    language: body.language ?? "fr",
    active,
    extensionId: ext.id,
  });
}

/** DELETE /v1/partner/members/:externalId: deactivates (history and extension kept, nobody rung). */
export async function deactivateMember(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow) {
  if (m.extensionId) {
    const ext = await deps.repo.pbx.getExtension(m.extensionId);
    if (ext) await deps.repo.pbx.updateExtension(ext.id, { userId: null, forwardToMobile: null });
  }
  const { name, email, phone, handle, language, extensionId } = m;
  return (await deps.repo.partners.upsertMember(p.id, m.externalId, { name, email, phone, handle, language, extensionId, active: false })).member;
}

// ------------------------------------------------------------------------------------ hunt groups

export async function huntGroupDto(deps: AppDeps, p: PartnerRow, key: string): Promise<PartnerHuntGroupDto | null> {
  const h = await deps.repo.partners.getHuntGroup(p.id, key);
  const g = h ? await deps.repo.pbx.getRingGroup(h.ringGroupId) : null;
  if (!h || !g) return null;
  const members = await deps.repo.partners.listMembers(p.id);
  const byExt = new Map(members.filter((m) => m.extensionId).map((m) => [m.extensionId!, m.externalId]));
  const did = (await deps.repo.pbx.listDidRoutes(p.businessId)).find((r) => r.target.type === "ring_group" && r.target.ringGroupId === g.id);
  return {
    key,
    name: g.name,
    members: g.memberExtensionIds.map((id) => byExt.get(id)).filter((x): x is string => Boolean(x)),
    strategy: g.strategy,
    ringTimeoutS: g.timeoutS,
    fallback: g.overflow?.type === "hangup" ? "hangup" : "voicemail",
    did: did?.e164 ?? null,
  };
}

/** PUT /v1/partner/hunt-groups/:key → one ring group of the business (created once, then updated in place). */
export async function putHuntGroup(deps: AppDeps, p: PartnerRow, business: BusinessRow, key: string, body: PartnerHuntGroupRequest) {
  const { features } = await getFeatures(deps.repo, business.telecomAccountId);
  if (!features.has("ring_groups")) throw forbidden("plan_required", "Hunt groups need a MIMT Affaires plan");
  const members = await deps.repo.partners.listMembers(p.id);
  const byId = new Map(members.map((m) => [m.externalId, m]));
  const unknown = body.members.filter((id) => !byId.get(id)?.extensionId);
  if (unknown.length) throw badRequest("unknown_member", `Unknown members: ${unknown.slice(0, 10).join(", ")}`);
  let didNumber = null;
  if (body.did) {
    didNumber = await deps.repo.getNumberByE164(body.did);
    if (!didNumber || didNumber.telecomAccountId !== business.telecomAccountId || !HELD_STATES.has(didNumber.state)) {
      throw badRequest("number_not_in_business", "This number is not held by the business");
    }
  }
  const fields = {
    name: (body.name ?? key).slice(0, 80),
    number: null,
    strategy: body.strategy,
    memberExtensionIds: [...new Set(body.members.map((id) => byId.get(id)!.extensionId!))],
    timeoutS: body.ringTimeoutS ?? 20,
    overflow: body.fallback === "hangup" ? ({ type: "hangup" } as const) : null,
  };
  const existing = await deps.repo.partners.getHuntGroup(p.id, key);
  const group = existing ? await deps.repo.pbx.getRingGroup(existing.ringGroupId) : null;
  const ring = group && group.businessId === business.id
    ? await deps.repo.pbx.updateRingGroup(group.id, fields)
    : await deps.repo.pbx.createRingGroup({ businessId: business.id, ...fields });
  await deps.repo.partners.upsertHuntGroup({ partnerId: p.id, key, ringGroupId: ring.id });
  if (didNumber) {
    await deps.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "ring_group", ringGroupId: ring.id } });
  }
  return { created: !group, huntGroup: (await huntGroupDto(deps, p, key))! };
}

// ---------------------------------------------------------------------------------------- credits

/** Admin top-up (POST /v1/admin/partners/:id/credits). Clears the « credits exhausted » alert. */
export async function topUpCredits(deps: AppDeps, p: PartnerRow, input: { credits: number; idempotencyKey: string; note: string | null; actorUserId: string; ip?: string }) {
  const res = await deps.repo.partners.applyCredit({
    partnerId: p.id,
    reason: "topup",
    credits: input.credits,
    idempotencyKey: `topup:${input.idempotencyKey}`,
    reference: "admin_topup",
    meta: input.note ? { note: input.note } : {},
    createdBy: input.actorUserId,
    at: deps.now(),
  });
  if (res.status === "insufficient") throw new Error("unreachable: top-ups are positive");
  if (res.status === "applied") {
    await deps.repo.partners.updatePartner(p.id, { creditsExhaustedAt: null });
    await deps.repo.audit({
      actorUserId: input.actorUserId,
      action: "partner.credits_topup",
      targetType: "partner",
      targetId: p.id,
      ip: input.ip ?? null,
      meta: { credits: input.credits, balance: res.balance, ledgerId: res.row.id, ...(input.note ? { note: input.note } : {}) },
    });
  }
  return { duplicate: res.status === "duplicate", balance: res.balance, entry: ledgerDto(res.row) };
}

// ------------------------------------------------------------------------------------- PBX hooks
// Called from the call path (pbx/engine.ts, routes/twilioPbx.ts, routes/twilioVoice.ts). They never throw: a
// partner hook failing must not drop or change a call (callers wrap them with safeHook).

export async function safeHook(log: Log | undefined, name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    log?.error({ err: err instanceof Error ? { name: err.name, message: err.message } : String(err), hook: name }, "partner hook failed");
  }
}

/** Resolves a DID target to the hunt group it rings now (a schedule is followed to its open/closed target). */
async function huntKeyFor(deps: AppDeps, p: PartnerRow, target: RouteTarget, at: Date): Promise<string | null> {
  let t: RouteTarget | null = target;
  if (t.type === "schedule") {
    const hours = await deps.repo.pbx.getHours(p.businessId);
    t = hours ? (isOpen(hours, at) ? hours.openTarget : hours.closedTarget) : null;
  }
  if (t?.type !== "ring_group") return null;
  return (await deps.repo.partners.getHuntGroupByRingGroup(t.ringGroupId))?.key ?? null;
}

/** Inbound call to a partner business number: one partner_calls row, and call.ringing once. */
export async function partnerCallRinging(deps: AppDeps, input: { business: BusinessRow; callSid: string; from: string; to: string; target: RouteTarget }) {
  const p = await activePartner(deps, input.business.id);
  if (!p) return;
  if (await deps.repo.partners.getCallBySid(input.callSid)) return; // Twilio retried the webhook.
  const at = deps.now();
  const call = await deps.repo.partners.createCall({
    partnerId: p.id,
    callSid: input.callSid,
    direction: "inbound",
    fromNumber: input.from,
    toNumber: input.to,
    huntGroupKey: await huntKeyFor(deps, p, input.target, at),
    startedAt: at,
  });
  await emitPartnerEvent(deps, p, "call.ringing", {
    call_id: call.id,
    direction: "inbound",
    hunt_group: call.huntGroupKey,
    from: call.fromNumber,
    to: call.toNumber,
    started_at: call.startedAt.toISOString(),
  });
}

/**
 * A member's leg was answered (app leg: Twilio "answered" status; mobile leg: the member pressed 1, so a carrier
 * voicemail never counts). The first answer wins; call.answered carries the member's externalId.
 */
export async function partnerLegAnswered(deps: AppDeps, input: { parentCallSid: string; legSid: string; extensionId: string }) {
  if (!partnersOn(deps)) return;
  const call = await deps.repo.partners.getCallBySid(input.parentCallSid);
  const member = call ? await deps.repo.partners.getMemberByExtension(input.extensionId) : null;
  if (!call || !member || member.partnerId !== call.partnerId || call.finalizedAt) return;
  const p = await deps.repo.partners.getPartner(call.partnerId);
  const answered = await deps.repo.partners.markAnswered(call.id, { memberId: member.id, externalId: member.externalId, legSid: input.legSid, at: deps.now() });
  if (!p || !answered) return;
  await emitPartnerEvent(deps, p, "call.answered", {
    call_id: call.id,
    direction: call.direction,
    member_external_id: member.externalId,
    hunt_group: call.huntGroupKey,
    answered_at: answered.answeredAt!.toISOString(),
  });
}

/** A member's leg ended: its duration is the talk time (only for the leg that answered, before the call is closed). */
export async function partnerLegCompleted(deps: AppDeps, input: { parentCallSid: string; legSid: string; durationS: number }) {
  if (!partnersOn(deps)) return;
  const call = await deps.repo.partners.getCallBySid(input.parentCallSid);
  if (!call || call.finalizedAt || call.answeredLegSid !== input.legSid) return;
  await deps.repo.partners.updateCall(call.id, { talkS: Math.max(0, Math.round(input.durationS)) });
}

/**
 * The caller's call ended (terminal status of the parent call). Runs once per call: debit per started minute of
 * talk time at the partner's rate, then call.completed. With too few credits the call is « unbilled » or
 * « partial » (the balance stops at zero) and an alert goes out once per empty balance. The caller was never
 * refused: we never drop a caller over the partner's balance (docs/MIMT-CONNECT.md, « Crédits »).
 */
export async function partnerCallEnded(deps: AppDeps, log: Log | undefined, input: { callSid: string }) {
  if (!partnersOn(deps)) return;
  const call = await deps.repo.partners.getCallBySid(input.callSid);
  if (!call) return;
  const at = deps.now();
  if (!(await deps.repo.partners.claimFinalize(call.id, at))) return;
  const p = await deps.repo.partners.getPartner(call.partnerId);
  if (!p) return;
  // The answered leg's own duration when it already came in; else answer → end of the parent call.
  const talkS = call.answeredAt ? (call.talkS ?? Math.max(0, Math.round((at.getTime() - call.answeredAt.getTime()) / 1000))) : 0;
  const cost = call.answeredAt ? Math.ceil(talkS / 60) * creditRate(deps, p) : 0;
  let charged = 0;
  let billing: PartnerCallRow["billing"] = call.answeredAt ? "billed" : "free";
  if (cost > 0) {
    const res = await deps.repo.partners.applyCredit({
      partnerId: p.id,
      reason: "call",
      credits: cost,
      idempotencyKey: `call:${call.callSid}`,
      reference: "call",
      meta: { callId: call.id, talkS, cost },
      at,
    });
    if (res.status !== "insufficient") charged = Math.abs(res.row.delta);
    billing = charged === cost ? "billed" : charged === 0 ? "unbilled" : "partial";
    if (billing !== "billed") await creditsExhausted(deps, log, p, { callId: call.id, cost, charged });
  }
  await deps.repo.partners.updateCall(call.id, { endedAt: at, talkS, creditsCharged: charged, billing });
  await emitPartnerEvent(deps, p, "call.completed", {
    call_id: call.id,
    direction: call.direction,
    ...(call.direction === "outbound" ? { reference: call.reference, from: call.fromNumber, to: call.toNumber } : {}),
    member_external_id: call.externalId,
    hunt_group: call.huntGroupKey,
    answered_at: call.answeredAt?.toISOString() ?? null,
    ended_at: at.toISOString(),
    duration_s: talkS,
    credits: charged,
    billing,
    unbilled_credits: cost - charged,
  });
}

/** One alert per empty balance (cleared by the next top-up): error log for monitoring + audit row. */
async function creditsExhausted(deps: AppDeps, log: Log | undefined, p: PartnerRow, meta: { callId: string; cost: number; charged: number }) {
  if (p.creditsExhaustedAt) return;
  await deps.repo.partners.updatePartner(p.id, { creditsExhaustedAt: deps.now() });
  log?.error({ partnerId: p.id, ...meta }, "partner credits exhausted: calls keep ringing, unbilled");
  await deps.repo.audit({ actorUserId: null, action: "partner.credits_exhausted", targetType: "partner", targetId: p.id, meta });
}

/** A recording of a partner call is stored: link it and send recording.ready (ids only, the URL comes from the API). */
export async function partnerRecordingReady(deps: AppDeps, input: { business: BusinessRow; recording: RecordingRow; callSid: string; parentCallSid?: string }) {
  const p = await activePartner(deps, input.business.id);
  if (!p) return;
  const call = (await deps.repo.partners.getCallBySid(input.callSid)) ?? (input.parentCallSid ? await deps.repo.partners.getCallBySid(input.parentCallSid) : null);
  if (!call || call.partnerId !== p.id) return;
  await deps.repo.partners.updateCall(call.id, { recordingId: input.recording.id });
  await emitPartnerEvent(deps, p, "recording.ready", {
    call_id: call.id,
    recording_id: input.recording.id,
    member_external_id: call.externalId,
    duration_s: input.recording.durationS,
  });
}
