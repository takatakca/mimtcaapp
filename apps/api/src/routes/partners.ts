// « MIMT Connect » partner platform (docs/MIMT-CONNECT.md). Three audiences:
//  - the partner's own system: /v1/partner/* with `Authorization: Bearer mimt_pk_…` (hashed keys), rate limited per key;
//  - MIMT staff: /v1/admin/partners/* (same allowlist as /v1/admin/affiliates: CATALOG_ADMIN_USER_IDS), audited;
//  - the business owner (webphone « Partenaire »): /v1/business/:id/partner/* (owner role);
//  - a MIMT user approving or revoking an account link (webphone /lier, Compte › Intégrations): /v1/me/partner-links*.
// PARTNERS=off (default): every route here answers 404, as if it did not exist.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NANP_E164,
  PARTNER_EXTERNAL_ID,
  PARTNER_HUNT_KEY,
  type MyPartnerLinkDto,
  type MyPartnerLinksResponse,
  type PartnerApiKeyCreated,
  type PartnerClickToCallResponse,
  type PartnerLinkPreview,
  type PartnerLinkRequestCreated,
  type PartnerMemberNumbersResponse,
  type PartnerCallsResponse,
  type PartnerCreditsResponse,
  type PartnerDto,
  type PartnerHuntGroupDto,
  type PartnerMemberDto,
  type PartnerOverviewResponse,
  type PartnerWebhookResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { requireRecentAuth } from "../auth/stepUp.js";
import { conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { businessAccess, Nanp } from "../pbx/access.js";
import type { BusinessRow } from "../repo/pbxTypes.js";
import type { PartnerApiKeyRow, PartnerMemberRow, PartnerRow } from "../repo/partners.js";
import {
  approveLink,
  clickToCall,
  createLinkRequest,
  listMyLinks,
  memberNumbers,
  previewLink,
  revokeLink,
  setMemberNumber,
  takeLinkAttempt,
} from "../services/partnerLinks.js";
import {
  apiKeyDto,
  authenticatePartnerKey,
  callDto,
  creditRate,
  deactivateMember,
  huntGroupDto,
  issueApiKey,
  ledgerDto,
  memberDto,
  partnerDto,
  partnersOn,
  PARTNER_RATE_RULE,
  putHuntGroup,
  recordingLink,
  revokeApiKey,
  rotateApiKey,
  setWebhook,
  topUpCredits,
  upsertMember,
} from "../services/partners.js";

const ExternalId = z.string().regex(PARTNER_EXTERNAL_ID, "1-100 characters: letters, digits, . _ - @ :");
const HuntKey = z.string().regex(PARTNER_HUNT_KEY, "lowercase letters, digits, _ and -, at most 60");
const Uuid = z.object({ id: z.uuid() });

const MemberBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.email().max(254).nullable().optional(),
    phone: Nanp.nullable().optional(),
    handle: z.string().trim().min(2).max(40).nullable().optional(),
    language: z.enum(["fr", "en"]).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const HuntGroupBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    members: z.array(ExternalId).max(50),
    strategy: z.enum(["simultaneous", "sequential"]),
    ringTimeoutS: z.number().int().min(5).max(120).optional(),
    fallback: z.enum(["voicemail", "hangup"]).optional(),
    did: Nanp.nullable().optional(),
  })
  .strict();

const CallsQuery = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  member: ExternalId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and -, at most 40");
const NumberBody = z.object({ e164: z.string().regex(NANP_E164).nullable() }).strict();
const ClickToCallBody = z
  .object({
    to: z.string().trim().min(1).max(30),
    reference: z.string().trim().min(1).max(100).optional(),
    via: z.enum(["app", "mobile"]).optional(),
  })
  .strict();
const LinkCodeBody = z
  .object({
    code: z.string().trim().min(1).max(20),
    requestId: z.uuid().optional(),
  })
  .strict();

/** Default slug from the partner's name: « besoinavocat.ca » → « besoinavocat ». */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(qc\.ca|ca|com|net|org)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "partenaire";
}

const CreatePartnerBody = z
  .object({
    businessId: z.uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    slug: Slug.optional(),
    creditPerMinute: z.number().int().min(0).max(10_000).nullable().optional(),
  })
  .strict();
const PatchPartnerBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: Slug.optional(),
    status: z.enum(["active", "suspended"]).optional(),
    creditPerMinute: z.number().int().min(0).max(10_000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "nothing to change");
const KeyBody = z.object({ label: z.string().trim().min(1).max(80).nullable().optional() }).strict();
const WebhookBody = z.object({ url: z.url().max(500).nullable(), rotateSecret: z.boolean().optional() }).strict();
const TopUpBody = z
  .object({
    credits: z.number().int().min(1).max(10_000_000),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    note: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

interface PartnerRequestContext {
  partner: PartnerRow;
  business: BusinessRow;
  key: PartnerApiKeyRow;
}

export async function partnerRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const ctxOf = new WeakMap<FastifyRequest, PartnerRequestContext>();

  // Kill switch first: with PARTNERS=off nothing below exists (no auth error either, just 404).
  app.addHook("onRequest", async () => {
    if (!partnersOn(deps)) throw notFound("not_found", "Route not found");
  });

  // ------------------------------------------------------------------------------- partner API

  const partnerAuth = {
    preHandler: async (req: FastifyRequest) => {
      const ctx = await authenticatePartnerKey(deps, req.headers.authorization);
      if (!(await deps.rateLimiter.take(`partner:key:${ctx.key.id}`, PARTNER_RATE_RULE))) {
        throw new HttpError(429, "rate_limited", "Too many requests for this API key; slow down.");
      }
      ctxOf.set(req, ctx);
    },
  };
  const pctx = (req: FastifyRequest) => ctxOf.get(req)!;
  /** Partner API writes: no MIMT user behind them, the key id says who. */
  const auditApi = (req: FastifyRequest, action: string, meta: Record<string, unknown>) =>
    repo.audit({ actorUserId: null, action, targetType: "partner", targetId: pctx(req).partner.id, ip: req.ip, meta: { keyId: pctx(req).key.id, ...meta } });

  app.put("/v1/partner/members/:externalId", partnerAuth, async (req, reply): Promise<PartnerMemberDto> => {
    const { externalId } = parse(z.object({ externalId: ExternalId }), req.params);
    const body = parse(MemberBody, req.body);
    const { partner, business } = pctx(req);
    const { member, created } = await upsertMember(deps, partner, business, externalId, body);
    await auditApi(req, created ? "partner.member_created" : "partner.member_updated", { externalId, active: member.active });
    return reply.code(created ? 201 : 200).send(await memberDto(deps, member));
  });

  app.get("/v1/partner/members", partnerAuth, async (req): Promise<{ members: PartnerMemberDto[] }> => {
    const members = await repo.partners.listMembers(pctx(req).partner.id);
    return { members: await Promise.all(members.map((m) => memberDto(deps, m))) };
  });

  app.get("/v1/partner/members/:externalId", partnerAuth, async (req): Promise<PartnerMemberDto> => {
    const { externalId } = parse(z.object({ externalId: ExternalId }), req.params);
    const m = await repo.partners.getMember(pctx(req).partner.id, externalId);
    if (!m) throw notFound("member_not_found", "Unknown member");
    return memberDto(deps, m);
  });

  app.delete("/v1/partner/members/:externalId", partnerAuth, async (req): Promise<PartnerMemberDto> => {
    const { externalId } = parse(z.object({ externalId: ExternalId }), req.params);
    const { partner } = pctx(req);
    const m = await repo.partners.getMember(partner.id, externalId);
    if (!m) throw notFound("member_not_found", "Unknown member");
    const updated = await deactivateMember(deps, partner, m);
    await auditApi(req, "partner.member_deactivated", { externalId });
    return memberDto(deps, updated);
  });

  // ------------------------------------------------------------- account link, line, click-to-call (lot A)

  async function memberOf(req: FastifyRequest): Promise<PartnerMemberRow> {
    const { externalId } = parse(z.object({ externalId: ExternalId }), req.params);
    const m = await repo.partners.getMember(pctx(req).partner.id, externalId);
    if (!m) throw notFound("member_not_found", "Unknown member");
    return m;
  }

  /** A one-time code (15 min) and the MIMT page where the member approves the link while signed in. */
  app.post("/v1/partner/members/:externalId/link-requests", partnerAuth, async (req, reply): Promise<PartnerLinkRequestCreated> => {
    const m = await memberOf(req);
    const created = await createLinkRequest(deps, pctx(req).partner, m);
    await auditApi(req, "partner.link_requested", { memberId: m.id, requestId: created.requestId });
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(created);
  });

  /** The partner ends the link (the member's MIMT apps stop ringing for it). */
  app.delete("/v1/partner/members/:externalId/link", partnerAuth, async (req, reply) => {
    const m = await memberOf(req);
    const link = await repo.partners.getActiveLinkByMember(m.id);
    if (!link) throw notFound("link_not_found", "This member is not linked");
    await revokeLink(deps, link, { side: "partner", actorUserId: null, ip: req.ip, keyId: pctx(req).key.id });
    return reply.code(204).send();
  });

  app.get("/v1/partner/members/:externalId/numbers", partnerAuth, async (req, reply): Promise<PartnerMemberNumbersResponse> => {
    const m = await memberOf(req);
    void reply.header("cache-control", "no-store");
    return memberNumbers(deps, pctx(req).partner, m);
  });

  app.put("/v1/partner/members/:externalId/number", partnerAuth, async (req): Promise<PartnerMemberNumbersResponse> => {
    const m = await memberOf(req);
    const { e164 } = parse(NumberBody, req.body);
    return setMemberNumber(deps, pctx(req).partner, m, e164, { ip: req.ip, keyId: pctx(req).key.id });
  });

  app.post("/v1/partner/members/:externalId/calls", partnerAuth, async (req, reply): Promise<PartnerClickToCallResponse> => {
    const m = await memberOf(req);
    const body = parse(ClickToCallBody, req.body);
    const { partner, business, key } = pctx(req);
    return reply.code(201).send(await clickToCall(deps, { partner, business, keyId: key.id, ip: req.ip }, m, body));
  });

  app.put("/v1/partner/hunt-groups/:key", partnerAuth, async (req, reply): Promise<PartnerHuntGroupDto> => {
    const { key } = parse(z.object({ key: HuntKey }), req.params);
    const body = parse(HuntGroupBody, req.body);
    const { partner, business } = pctx(req);
    const { created, huntGroup } = await putHuntGroup(deps, partner, business, key, body);
    await auditApi(req, created ? "partner.hunt_group_created" : "partner.hunt_group_updated", { key, members: body.members.length });
    return reply.code(created ? 201 : 200).send(huntGroup);
  });

  app.get("/v1/partner/hunt-groups", partnerAuth, async (req): Promise<{ huntGroups: PartnerHuntGroupDto[] }> => {
    const { partner } = pctx(req);
    const rows = await repo.partners.listHuntGroups(partner.id);
    const groups = await Promise.all(rows.map((h) => huntGroupDto(deps, partner, h.key)));
    return { huntGroups: groups.filter((g): g is PartnerHuntGroupDto => Boolean(g)) };
  });

  app.get("/v1/partner/calls", partnerAuth, async (req, reply): Promise<PartnerCallsResponse> => {
    const q = parse(CallsQuery, req.query);
    const { partner } = pctx(req);
    const rows = await repo.partners.listCalls(partner.id, { limit: q.limit, ...(q.since ? { since: new Date(q.since) } : {}), ...(q.member ? { externalId: q.member } : {}) });
    void reply.header("cache-control", "no-store");
    const last = rows[rows.length - 1];
    return { calls: await Promise.all(rows.map((c) => callDto(deps, partner, c))), nextSince: rows.length === q.limit && last ? last.startedAt.toISOString() : null };
  });

  /** A fresh short-lived URL for a recording (the one in recording.ready webhooks is only an id). */
  app.get("/v1/partner/recordings/:id", partnerAuth, async (req, reply) => {
    const { id } = parse(Uuid, req.params);
    const { partner } = pctx(req);
    const link = await recordingLink(deps, partner.businessId, id);
    if (!link) throw notFound("recording_not_found", "Unknown or expired recording");
    void reply.header("cache-control", "no-store");
    return { recordingId: id, url: link.url, expiresAt: link.expiresAt };
  });

  app.get("/v1/partner/credits", partnerAuth, async (req, reply): Promise<PartnerCreditsResponse> => {
    const partner = (await repo.partners.getPartner(pctx(req).partner.id))!;
    void reply.header("cache-control", "no-store");
    return { balance: partner.creditBalance, creditPerMinute: creditRate(deps, partner), ledger: (await repo.partners.listLedger(partner.id, 100)).map(ledgerDto) };
  });

  // ------------------------------------------------------------------------------------- admin

  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };
  const actor = (req: FastifyRequest) => ({ actorUserId: req.userId, ip: req.ip });

  async function partnerById(req: FastifyRequest): Promise<PartnerRow> {
    const r = Uuid.safeParse(req.params);
    const p = r.success ? await repo.partners.getPartner(r.data.id) : null;
    if (!p) throw notFound("partner_not_found", "Partenaire introuvable.");
    return p;
  }

  app.get("/v1/admin/partners", admin, async (_req, reply): Promise<{ partners: PartnerDto[] }> => {
    void reply.header("cache-control", "no-store");
    return { partners: (await repo.partners.listPartners()).map((p) => partnerDto(deps, p)) };
  });

  app.get("/v1/admin/partners/:id", admin, async (req, reply) => {
    const p = await partnerById(req);
    void reply.header("cache-control", "no-store");
    return {
      partner: partnerDto(deps, p),
      apiKeys: (await repo.partners.listApiKeys(p.id)).map(apiKeyDto),
      ledger: (await repo.partners.listLedger(p.id, 50)).map(ledgerDto),
    };
  });

  /** Makes an existing MIMT business a partner. */
  app.post("/v1/admin/partners", admin, async (req, reply): Promise<PartnerDto> => {
    const body = parse(CreatePartnerBody, req.body);
    const business = await repo.pbx.getBusiness(body.businessId);
    if (!business) throw notFound("business_not_found", "Entreprise introuvable.");
    if (await repo.partners.getPartnerByBusiness(business.id)) throw conflict("partner_exists", "Cette entreprise est déjà partenaire.");
    const name = body.name ?? business.name;
    const slug = body.slug ?? slugify(name);
    if (await repo.partners.getPartnerBySlug(slug)) throw conflict("slug_taken", "Ce nom court est déjà pris : choisissez un autre « slug ».");
    const p = await repo.partners.createPartner({ businessId: business.id, name, slug, creditPerMinute: body.creditPerMinute ?? null, createdBy: req.userId });
    await repo.audit({ ...actor(req), action: "partner.created", targetType: "partner", targetId: p.id, meta: { businessId: business.id } });
    return reply.code(201).send(partnerDto(deps, p));
  });

  app.patch("/v1/admin/partners/:id", admin, async (req): Promise<PartnerDto> => {
    const p = await partnerById(req);
    const body = parse(PatchPartnerBody, req.body);
    if (body.slug && body.slug !== p.slug && (await repo.partners.getPartnerBySlug(body.slug))) throw conflict("slug_taken", "Ce nom court est déjà pris.");
    const updated = (await repo.partners.updatePartner(p.id, body))!;
    await repo.audit({ ...actor(req), action: "partner.updated", targetType: "partner", targetId: p.id, meta: { before: partnerDto(deps, p), after: partnerDto(deps, updated) } });
    return partnerDto(deps, updated);
  });

  app.post("/v1/admin/partners/:id/keys", admin, async (req, reply): Promise<PartnerApiKeyCreated> => {
    const p = await partnerById(req);
    const body = parse(KeyBody, req.body ?? {});
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(await issueApiKey(deps, p, { label: body.label ?? null, ...actor(req) }));
  });

  app.delete("/v1/admin/partners/:id/keys/:keyId", admin, async (req, reply) => {
    const p = await partnerById(req);
    const { keyId } = parse(z.object({ id: z.uuid(), keyId: z.uuid() }), req.params);
    if (!(await revokeApiKey(deps, p, keyId, actor(req)))) throw notFound("key_not_found", "Clé introuvable ou déjà révoquée.");
    return reply.code(204).send();
  });

  app.post("/v1/admin/partners/:id/keys/:keyId/rotate", admin, async (req, reply): Promise<PartnerApiKeyCreated> => {
    const p = await partnerById(req);
    const { keyId } = parse(z.object({ id: z.uuid(), keyId: z.uuid() }), req.params);
    const created = await rotateApiKey(deps, p, keyId, actor(req));
    if (!created) throw notFound("key_not_found", "Clé introuvable ou déjà révoquée.");
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(created);
  });

  app.put("/v1/admin/partners/:id/webhook", admin, async (req, reply): Promise<PartnerWebhookResponse> => {
    const p = await partnerById(req);
    void reply.header("cache-control", "no-store");
    return setWebhook(deps, p, parse(WebhookBody, req.body), actor(req));
  });

  /** Top-up (admin only for now; a Stripe top-up can call topUpCredits later). Audited inside. */
  app.post("/v1/admin/partners/:id/credits", admin, async (req) => {
    const p = await partnerById(req);
    const body = parse(TopUpBody, req.body);
    return topUpCredits(deps, p, { credits: body.credits, idempotencyKey: body.idempotencyKey, note: body.note ?? null, ...actor(req) });
  });

  // ------------------------------------------------------------------------ business owner (webphone)

  const owner = { preHandler: requireUser(deps) };
  async function ownerPartner(req: FastifyRequest) {
    const ctx = await businessAccess(deps, req, "owner");
    const p = await repo.partners.getPartnerByBusiness(ctx.business.id);
    if (!p) throw notFound("partner_not_found", "Cette entreprise n'est pas encore partenaire MIMT Connect.");
    return { ctx, p };
  }

  app.get("/v1/business/:id/partner", owner, async (req, reply): Promise<PartnerOverviewResponse> => {
    const { p } = await ownerPartner(req);
    void reply.header("cache-control", "no-store");
    const calls = await repo.partners.listRecentCalls(p.id, 20);
    return {
      partner: partnerDto(deps, p),
      apiKeys: (await repo.partners.listApiKeys(p.id)).map(apiKeyDto),
      calls: await Promise.all(calls.map((c) => callDto(deps, p, c))),
    };
  });

  app.post("/v1/business/:id/partner/keys", owner, async (req, reply): Promise<PartnerApiKeyCreated> => {
    const { p } = await ownerPartner(req);
    // A key or a signing secret opens the business's call data: recent passkey or SMS confirmation first.
    await requireRecentAuth(deps, req);
    const body = parse(KeyBody, req.body ?? {});
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(await issueApiKey(deps, p, { label: body.label ?? null, ...actor(req) }));
  });

  app.delete("/v1/business/:id/partner/keys/:keyId", owner, async (req, reply) => {
    const { p } = await ownerPartner(req);
    const { keyId } = parse(z.object({ id: z.uuid(), keyId: z.uuid() }), req.params);
    if (!(await revokeApiKey(deps, p, keyId, actor(req)))) throw notFound("key_not_found", "Clé introuvable ou déjà révoquée.");
    return reply.code(204).send();
  });

  app.post("/v1/business/:id/partner/keys/:keyId/rotate", owner, async (req, reply): Promise<PartnerApiKeyCreated> => {
    const { p } = await ownerPartner(req);
    // A key or a signing secret opens the business's call data: recent passkey or SMS confirmation first.
    await requireRecentAuth(deps, req);
    const { keyId } = parse(z.object({ id: z.uuid(), keyId: z.uuid() }), req.params);
    const created = await rotateApiKey(deps, p, keyId, actor(req));
    if (!created) throw notFound("key_not_found", "Clé introuvable ou déjà révoquée.");
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(created);
  });

  app.put("/v1/business/:id/partner/webhook", owner, async (req, reply): Promise<PartnerWebhookResponse> => {
    const { p } = await ownerPartner(req);
    // A key or a signing secret opens the business's call data: recent passkey or SMS confirmation first.
    await requireRecentAuth(deps, req);
    void reply.header("cache-control", "no-store");
    return setWebhook(deps, p, parse(WebhookBody, req.body), actor(req));
  });

  // ------------------------------------------------------------------- MIMT user: account links (lot A)

  const me = { preHandler: requireUser(deps) };

  /** What the person is about to approve (no step-up yet; same attempt limits as approve). */
  app.post("/v1/me/partner-links/preview", me, async (req, reply): Promise<PartnerLinkPreview> => {
    await takeLinkAttempt(deps, req.userId, req.ip);
    void reply.header("cache-control", "no-store");
    return previewLink(deps, parse(LinkCodeBody, req.body));
  });

  /** Ties the member to this MIMT account: proof (signed in + recent passkey or SMS code) and consent. */
  app.post("/v1/me/partner-links/approve", me, async (req, reply): Promise<MyPartnerLinkDto> => {
    await takeLinkAttempt(deps, req.userId, req.ip);
    await requireRecentAuth(deps, req);
    const link = await approveLink(deps, req.userId, parse(LinkCodeBody, req.body), req.ip);
    void reply.header("cache-control", "no-store");
    return reply.code(201).send(link);
  });

  app.get("/v1/me/partner-links", me, async (req, reply): Promise<MyPartnerLinksResponse> => {
    void reply.header("cache-control", "no-store");
    return { links: await listMyLinks(deps, req.userId) };
  });

  /** Consent is revocable at any time, without step-up (it only takes access away). */
  app.delete("/v1/me/partner-links/:id", me, async (req, reply) => {
    const { id } = parse(Uuid, req.params);
    const link = await repo.partners.getLink(id);
    if (!link || link.userId !== req.userId || link.revokedAt) throw notFound("link_not_found", "Lien introuvable.");
    await revokeLink(deps, link, { side: "user", actorUserId: req.userId, ip: req.ip });
    return reply.code(204).send();
  });
}
