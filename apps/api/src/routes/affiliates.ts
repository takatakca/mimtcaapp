import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AFFILIATE_AUDIENCE_SIZES,
  AFFILIATE_CHANNELS,
  AFFILIATE_LIMITS,
  AFFILIATE_PRIVACY_NOTICE_VERSION,
  AFFILIATE_PROVINCES,
  type AdminAffiliateDto,
  type AffiliateApplicationResponse,
  type AffiliateAttributionResponse,
  type AffiliateDashboardResponse,
  type SendContractResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { parseConnectEvent, verifyConnectSignature } from "../gateways/docusign.js";
import { sha256Hex } from "../lib/crypto.js";
import { badRequest, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import {
  adminAffiliateDto,
  affiliateDashboard,
  approveAffiliate,
  attributeAccount,
  handleContractEvent,
  markAffiliatePaid,
  markAffiliateSigned,
  normalizeNanpPhone,
  payableCommissionsCsv,
  rejectAffiliate,
  sendAffiliateContract,
  setAffiliateStatus,
  setAffiliateTerms,
  submitAffiliateApplication,
} from "../services/affiliates.js";

/** Bots post as soon as the page loads; a person needs a few seconds for this form. */
export const MIN_FILL_MS = 3000;
/** All applications per rolling day, whatever the IP (spam flood guard; the form says to write to us if refused). */
export const DAILY_APPLICATIONS_CAP = 200;

const text = (max: number) => z.string().trim().min(1).max(max);
const Application = z.object({
  legalName: text(120),
  businessName: z.string().trim().max(120).optional(),
  email: z.email().max(200),
  phone: z.string().min(7).max(30),
  province: z.enum(AFFILIATE_PROVINCES),
  channels: z.array(z.enum(AFFILIATE_CHANNELS)).min(1).max(AFFILIATE_CHANNELS.length),
  audienceSize: z.enum(AFFILIATE_AUDIENCE_SIZES),
  gstNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^(\d{9}\s?RT\s?\d{4})?$/i, "GST/HST number: 9 digits, RT, 4 digits")
    .optional(),
  qstNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^(\d{10}\s?TQ\s?\d{4})?$/i, "QST number: 10 digits, TQ, 4 digits")
    .optional(),
  locale: z.enum(["fr-CA", "en-CA"]).default("fr-CA"),
  consents: z.object({
    privacyNotice: z.literal(true),
    privacyNoticeVersion: z.string().min(1).max(40).default(AFFILIATE_PRIVACY_NOTICE_VERSION),
    marketing: z.boolean().default(false),
  }),
  adult: z.literal(true),
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});

const Terms = z.object({
  commissionBps: z.number().int().min(AFFILIATE_LIMITS.commissionBps.min).max(AFFILIATE_LIMITS.commissionBps.max),
  durationMonths: z.number().int().min(AFFILIATE_LIMITS.durationMonths.min).max(AFFILIATE_LIMITS.durationMonths.max),
  payoutThresholdCents: z.number().int().min(AFFILIATE_LIMITS.payoutThresholdCents.min).max(AFFILIATE_LIMITS.payoutThresholdCents.max),
});
const IdParam = z.object({ id: z.string().uuid() });
const Reason = z.object({ reason: z.string().trim().max(300).optional() });

/**
 * « Programme d'agents affiliés » (docs/MIMT-AFFILIATES.md).
 * Public: POST /v1/public/affiliates/applications (mimt.ca form). Signed-in: attribution and the dashboard.
 * Admin (CATALOG_ADMIN_USER_IDS, like routes/adminCosts.ts): review, terms, contract, payouts.
 * DocuSign Connect: POST /webhooks/docusign (HMAC).
 */
export async function affiliateRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };

  // ------------------------------------------------------------------ public application
  // Per-IP: 5 per hour (route rate limit, in memory). The request body is never logged (personal data).
  app.post(
    "/v1/public/affiliates/applications",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply): Promise<AffiliateApplicationResponse> => {
      const body = parse(Application, req.body);
      reply.code(202);
      // Honeypot or instant post: answer like a success, store nothing.
      if (body.website || (body.elapsedMs !== undefined && body.elapsedMs < MIN_FILL_MS)) return { received: true };
      const phoneE164 = normalizeNanpPhone(body.phone);
      if (!phoneE164) throw badRequest("invalid_phone", "Entrez un numéro de téléphone canadien à 10 chiffres.");
      const ipKey = `affiliate-apply:ip:${sha256Hex(`${req.ip}`).slice(0, 32)}`;
      const perIpDay = await deps.rateLimiter.take(ipKey, { capacity: 10, windowSeconds: 86_400 });
      const global = perIpDay && (await deps.rateLimiter.take("affiliate-apply:all", { capacity: DAILY_APPLICATIONS_CAP, windowSeconds: 86_400 }));
      if (!global) throw new HttpError(429, "too_many_applications", "Trop de demandes. Réessayez demain ou écrivez à info@mimt.ca.");
      await submitAffiliateApplication(deps, {
        ...body,
        consents: { privacyNotice: true, privacyNoticeVersion: body.consents.privacyNoticeVersion, marketing: body.consents.marketing },
        phoneE164,
      });
      return { received: true };
    },
  );

  // ------------------------------------------------------------------ signed-in
  const Attribution = z.object({ code: z.string().min(4).max(32), touchedAt: z.iso.datetime().optional() });
  app.post(
    "/v1/affiliates/attribution",
    { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req): Promise<AffiliateAttributionResponse> => {
      const body = parse(Attribution, req.body);
      const { user, account } = await loadContext(deps, req);
      const attributed = await attributeAccount(deps, { user, account, code: body.code, touchedAt: body.touchedAt ? new Date(body.touchedAt) : null, source: "signup" });
      return { attributed };
    },
  );

  app.get("/v1/affiliates/me", auth, async (req, reply): Promise<AffiliateDashboardResponse> => {
    const { user } = await loadContext(deps, req);
    const dash = await affiliateDashboard(deps, user);
    if (!dash) throw notFound("not_affiliate", "Ce compte n'est pas un agent affilié actif.");
    void reply.header("cache-control", "no-store");
    return dash;
  });

  // ------------------------------------------------------------------ admin
  const StatusFilter = z.object({
    status: z.enum(["applied", "approved", "rejected", "contract_sent", "active", "suspended", "terminated"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });
  app.get("/v1/admin/affiliates", admin, async (req, reply): Promise<{ affiliates: AdminAffiliateDto[] }> => {
    const q = parse(StatusFilter, req.query);
    void reply.header("cache-control", "no-store");
    const rows = await deps.repo.affiliates.list({ limit: q.limit, ...(q.status ? { status: q.status } : {}) });
    return { affiliates: rows.map((r) => adminAffiliateDto(deps, r)) };
  });

  app.get("/v1/admin/affiliates/:id", admin, async (req, reply): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const row = await deps.repo.affiliates.get(id);
    if (!row) throw notFound("affiliate_not_found");
    void reply.header("cache-control", "no-store");
    return adminAffiliateDto(deps, row);
  });

  app.post("/v1/admin/affiliates/:id/approve", admin, async (req): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const terms = parse(Terms.partial().default({}), req.body ?? {});
    return adminAffiliateDto(deps, await approveAffiliate(deps, id, req.userId, terms));
  });

  app.post("/v1/admin/affiliates/:id/reject", admin, async (req): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(Reason, req.body ?? {});
    return adminAffiliateDto(deps, await rejectAffiliate(deps, id, req.userId, reason ?? null));
  });

  app.put("/v1/admin/affiliates/:id/terms", admin, async (req): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const terms = parse(Terms, req.body);
    return adminAffiliateDto(deps, await setAffiliateTerms(deps, id, req.userId, terms));
  });

  app.post("/v1/admin/affiliates/:id/contract", admin, async (req): Promise<SendContractResponse> => {
    const { id } = parse(IdParam, req.params);
    return sendAffiliateContract(deps, id, req.userId);
  });

  const Signed = z.object({ signedAt: z.iso.datetime().optional() });
  app.post("/v1/admin/affiliates/:id/signed", admin, async (req): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const { signedAt } = parse(Signed, req.body ?? {});
    const at = signedAt ? new Date(signedAt) : deps.now();
    if (at > deps.now()) throw badRequest("signed_in_future");
    return adminAffiliateDto(deps, await markAffiliateSigned(deps, id, { actorUserId: req.userId, signedAt: at, via: "manual" }));
  });

  const StatusBody = z.object({ status: z.enum(["active", "suspended", "terminated"]), reason: z.string().trim().max(300).optional() });
  app.post("/v1/admin/affiliates/:id/status", admin, async (req): Promise<AdminAffiliateDto> => {
    const { id } = parse(IdParam, req.params);
    const body = parse(StatusBody, req.body);
    return adminAffiliateDto(deps, await setAffiliateStatus(deps, id, req.userId, body.status, body.reason ?? null));
  });

  app.get("/v1/admin/affiliate-commissions/payable.csv", admin, async (_req, reply) => {
    const { csv } = await payableCommissionsCsv(deps);
    void reply
      .header("cache-control", "no-store")
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="mimt-commissions-payables-${deps.now().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  const MarkPaid = z.object({
    affiliateId: z.string().uuid(),
    payoutRef: z.string().trim().min(1).max(100),
    ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  });
  app.post("/v1/admin/affiliate-commissions/mark-paid", admin, async (req) => {
    const body = parse(MarkPaid, req.body);
    return markAffiliatePaid(deps, { ...body, actorUserId: req.userId });
  });

  // ------------------------------------------------------------------ DocuSign Connect (raw body for the HMAC)
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/webhooks/docusign", { config: { rateLimit: false } }, async (req) => {
      const key = deps.config.DOCUSIGN_CONNECT_HMAC_KEY;
      if (!key) throw notConfigured("DocuSign Connect");
      if (!Buffer.isBuffer(req.body) || !verifyConnectSignature(key, req.body, req.headers)) {
        throw new HttpError(401, "invalid_signature", "DocuSign Connect signature verification failed");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        return { received: true, ignored: "malformed" };
      }
      const event = parseConnectEvent(payload);
      if (!event) return { received: true, ignored: "no_envelope" };
      const outcome = await handleContractEvent(deps, event, app.log);
      return { received: true, outcome };
    });
  });
}
