import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CAMPAIGN_TARGETS,
  MAX_CAMPAIGN_BONUS,
  MAX_CAMPAIGN_MULTIPLIER,
  type PointsCampaignAdminDto,
  type PointsCatalogResponse,
  type PointsRedeemResponse,
  type PointsResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { PointsCampaignPatch, PointsCampaignRow } from "../repo/points.js";
import { campaignAdminDto, catalogView, pointsView, redeemReward } from "../services/points.js";

/** Redemptions per account: a burst of 5, then one every 12 s (on top of the route limit per IP). */
const REDEEM_RULE = { capacity: 5, windowSeconds: 60 };

const RedeemBody = z.object({
  rewardId: z.string().regex(/^[a-z0-9_]{2,40}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
});

const CampaignBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(["multiplier", "bonus"]),
    target: z.enum(CAMPAIGN_TARGETS as unknown as [string, ...string[]]),
    multiplier: z.number().gt(1).max(MAX_CAMPAIGN_MULTIPLIER).multipleOf(0.01).optional(),
    bonusPoints: z.number().int().min(1).max(MAX_CAMPAIGN_BONUS).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    budgetPoints: z.number().int().min(1).max(10_000_000),
  })
  .strict()
  .refine((b) => (b.kind === "multiplier") === (b.multiplier !== undefined), "multiplier campaigns need a multiplier (and only them)")
  .refine((b) => (b.kind === "bonus") === (b.bonusPoints !== undefined), "bonus campaigns need bonusPoints (and only them)")
  .refine((b) => new Date(b.endsAt).getTime() > new Date(b.startsAt).getTime(), "endsAt must be after startsAt");

const CampaignPatch = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    budgetPoints: z.number().int().min(1).max(10_000_000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "nothing to change");

/**
 * « MIMT Points »: GET /v1/points, GET /v1/points/catalog, POST /v1/points/redeem; admin campaign CRUD under
 * /v1/admin/points/campaigns (same allowlist as /v1/admin/costs: CATALOG_ADMIN_USER_IDS). There is deliberately no
 * route to earn points: they are credited by the routes and webhooks that see the event (services/points.ts).
 */
export async function pointsRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };

  app.get("/v1/points", auth, async (req, reply): Promise<PointsResponse> => {
    const { account } = await loadContext(deps, req);
    void reply.header("cache-control", "no-store");
    return pointsView(deps, account, req.log);
  });

  app.get("/v1/points/catalog", auth, async (req, reply): Promise<PointsCatalogResponse> => {
    const { account } = await loadContext(deps, req);
    void reply.header("cache-control", "no-store");
    return catalogView(deps, account);
  });

  app.post("/v1/points/redeem", { ...auth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req): Promise<PointsRedeemResponse> => {
    const body = parse(RedeemBody, req.body);
    const { user, account } = await loadContext(deps, req);
    if (!(await deps.rateLimiter.take(`points:redeem:${account.id}`, REDEEM_RULE))) {
      throw new HttpError(429, "rate_limited", "Trop d'échanges d'un coup. Réessayez dans un instant.");
    }
    return redeemReward(deps, { account, user, rewardId: body.rewardId, clientKey: body.idempotencyKey, ip: req.ip, log: req.log });
  });

  // ------------------------------------------------------------------------------------------- admin
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };

  /** Audit trail of every campaign change: who, what, before and after (no customer data in a campaign). */
  const auditCampaign = (req: FastifyRequest, action: string, before: PointsCampaignRow | null, after: PointsCampaignRow) =>
    deps.repo.audit({
      actorUserId: req.userId,
      action,
      targetType: "points_campaign",
      targetId: after.id,
      ip: req.ip,
      meta: { before: before ? campaignAdminDto(before) : null, after: campaignAdminDto(after) },
    });

  app.get("/v1/admin/points/campaigns", admin, async (_req, reply): Promise<{ campaigns: PointsCampaignAdminDto[] }> => {
    void reply.header("cache-control", "no-store");
    return { campaigns: (await deps.repo.points.listCampaigns()).map(campaignAdminDto) };
  });

  app.post("/v1/admin/points/campaigns", admin, async (req, reply): Promise<PointsCampaignAdminDto> => {
    const body = parse(CampaignBody, req.body);
    const endsAt = new Date(body.endsAt);
    if (endsAt.getTime() <= deps.now().getTime()) throw badRequest("campaign_ended", "La campagne doit se terminer dans le futur.");
    const row = await deps.repo.points.createCampaign({
      name: body.name,
      kind: body.kind,
      target: body.target as PointsCampaignRow["target"],
      multiplier: body.kind === "multiplier" ? body.multiplier! : null,
      bonusPoints: body.kind === "bonus" ? body.bonusPoints! : null,
      startsAt: new Date(body.startsAt),
      endsAt,
      budgetPoints: body.budgetPoints,
      createdBy: req.userId,
    });
    await auditCampaign(req, "points.campaign_created", null, row);
    return reply.code(201).send(campaignAdminDto(row));
  });

  app.patch("/v1/admin/points/campaigns/:id", admin, async (req): Promise<PointsCampaignAdminDto> => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("campaign_not_found");
    const body = parse(CampaignPatch, req.body);
    const before = await deps.repo.points.getCampaign(id);
    if (!before) throw notFound("campaign_not_found", "Campagne introuvable.");
    const patch: PointsCampaignPatch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
      ...(body.budgetPoints !== undefined ? { budgetPoints: body.budgetPoints } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    };
    if (patch.budgetPoints !== undefined && patch.budgetPoints < before.spentPoints) {
      throw conflict("budget_below_spent", `Le budget ne peut pas être sous les ${before.spentPoints} points déjà donnés.`);
    }
    if (patch.endsAt && patch.endsAt.getTime() <= before.startsAt.getTime()) throw badRequest("invalid_window", "La fin doit suivre le début.");
    const after = await deps.repo.points.updateCampaign(id, patch);
    if (!after) throw notFound("campaign_not_found", "Campagne introuvable.");
    await auditCampaign(req, "points.campaign_updated", before, after);
    return campaignAdminDto(after);
  });

  /** Ends a campaign now (kept for the record and the audit: campaigns are never deleted). */
  app.delete("/v1/admin/points/campaigns/:id", admin, async (req): Promise<PointsCampaignAdminDto> => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("campaign_not_found");
    const before = await deps.repo.points.getCampaign(id);
    if (!before) throw notFound("campaign_not_found", "Campagne introuvable.");
    const after = await deps.repo.points.updateCampaign(id, { active: false });
    await auditCampaign(req, "points.campaign_stopped", before, after!);
    return campaignAdminDto(after!);
  });
}
