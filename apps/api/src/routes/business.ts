// MIMT Affaires admin API (/v1/business/*). Contract: packages/shared/src/business.ts.
// Access: every route goes through businessAccess (not a member → 404, role too low → 403).
// Routing logic itself lives in src/pbx/ (router.ts is pure and unit-tested).

import { planOf } from "../plansConfig.js";
import { callSummaryDto } from "../ai/callSummary.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DEFAULT_WEEKLY_SCHEDULE,
  NANP_E164,
  BUSINESS_TIMEZONE,
  type BusinessCallRecord,
  type BusinessCallsResponse,
  type BusinessesResponse,
  type BusinessHours,
  type BusinessHoursResponse,
  type BusinessRecordingDto,
  type BusinessRecordingsResponse,
  type BusinessResponse,
  type BusinessUsageResponse,
  type CallRecordingResponse,
  type ClaimInvitesResponse,
  type ClaimNumberResponse,
  type DidRoutesResponse,
  type ExtensionsResponse,
  type Feature,
  type IvrMenusResponse,
  type MembersResponse,
  type RingGroupsResponse,
  type SeatsResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { recordingAccountSid } from "../gateways/twilio.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { classifyDestination } from "../lib/phone.js";
import { monthPeriod } from "../lib/time.js";
import { parse } from "../lib/validate.js";
import {
  assertTarget,
  Bilingual,
  businessAccess,
  businessDto,
  didDto,
  ExtensionNumber,
  extensionDto,
  HolidaySchema,
  isAdmin,
  ivrDto,
  memberDto,
  Nanp,
  ringGroupDto,
  RouteTargetSchema,
  WeeklySchema,
  type BusinessContext,
} from "../pbx/access.js";
import { businessPlan, businessSubscription } from "../pbx/engine.js";
import { isOpen } from "../pbx/router.js";
import type { BusinessRow, ExtensionRow } from "../repo/pbxTypes.js";
import type { Call } from "../repo/types.js";
import { getFeatures, HELD_STATES, isLiveSubscription, outboundBlocked } from "../services/accounts.js";
import { createPlanCheckout } from "../billing/planCheckout.js";
import { e911Ready } from "./e911.js";

/** Lifetime of the signed recording URLs. */
export const RECORDING_URL_TTL_S = 15 * 60;
const recordingResource = (id: string) => `business-recording:${id}`;

const Locale = z.enum(["fr-CA", "en-CA"]);
const Role = z.enum(["admin", "member"]);
const Sub = <K extends string>(key: K) => z.object({ id: z.uuid() }).extend({ [key]: z.uuid() } as Record<K, z.ZodUUID>);

const CreateBusinessBody = z.object({ name: z.string().trim().min(1).max(120), takatakBusinessId: z.string().min(1).max(128).optional(), locale: Locale.optional() });
const UpdateBusinessBody = z.object({ name: z.string().trim().min(1).max(120).optional(), mainNumber: Nanp.nullable().optional(), locale: Locale.optional() });
const InviteBody = z.object({ email: z.email().max(254), role: Role });
const ExtensionBody = z.object({
  number: ExtensionNumber,
  displayName: z.string().trim().min(1).max(80),
  userId: z.uuid().nullable().optional(),
  voicemail: z.object({ enabled: z.boolean(), greeting: Bilingual.nullable() }).optional(),
  forwardToMobile: Nanp.nullable().optional(),
  did: Nanp.nullable().optional(),
  ringTimeoutS: z.number().int().min(5).max(120).optional(),
});
const RingGroupBody = z.object({
  name: z.string().trim().min(1).max(80),
  number: ExtensionNumber.nullable().optional(),
  strategy: z.enum(["simultaneous", "sequential"]),
  memberExtensionIds: z.array(z.uuid()).max(50),
  timeoutS: z.number().int().min(5).max(120).optional(),
  overflow: RouteTargetSchema.nullable().optional(),
});
const IvrBody = z.object({
  name: z.string().trim().min(1).max(80),
  greeting: Bilingual,
  greetingRecordingUrl: z.url().startsWith("https://").max(1000).nullable().optional(),
  options: z
    .array(z.object({ digit: z.string().regex(/^[0-9*#]$/), target: RouteTargetSchema }))
    .max(12)
    .refine((o) => new Set(o.map((x) => x.digit)).size === o.length, "each digit once"),
  timeoutS: z.number().int().min(2).max(30).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  timeoutTarget: RouteTargetSchema.nullable().optional(),
  invalidTarget: RouteTargetSchema.nullable().optional(),
});
const HoursBody = z.object({
  weekly: WeeklySchema,
  holidays: z.array(HolidaySchema).max(100),
  quebecHolidays: z.boolean(),
  openTarget: RouteTargetSchema,
  closedTarget: RouteTargetSchema,
});
const DidBody = z.object({ e164: Nanp, target: RouteTargetSchema });
const RecordingPolicyBody = z.object({
  mode: z.enum(["off", "all", "on_demand"]),
  consentPrompt: Bilingual.optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});
const PageQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

/** Default hours when none are stored: Mon-Fri 9-17, Quebec holidays, voicemail either way. */
export function defaultHours(businessId: string): BusinessHours {
  return {
    businessId,
    timezone: BUSINESS_TIMEZONE,
    weekly: structuredClone(DEFAULT_WEEKLY_SCHEDULE),
    holidays: [],
    quebecHolidays: true,
    openTarget: { type: "voicemail" },
    closedTarget: { type: "voicemail" },
  };
}

function callDto(c: Call): BusinessCallRecord {
  return {
    id: c.id,
    direction: c.direction,
    kind: c.kind,
    userId: c.userId,
    from: c.fromNumber,
    to: c.toNumber,
    status: c.status,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationS: c.durationS,
  };
}

export async function businessRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const { pbx } = repo;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const auth = { preHandler: requireUser(deps) };
  const audit = (ctx: BusinessContext, req: FastifyRequest, action: string, targetId: string, meta?: Record<string, unknown>) =>
    repo.audit({ actorUserId: ctx.user.id, action, targetType: "business", targetId, ip: req.ip, ...(meta ? { meta } : {}) });

  async function response(business: BusinessRow, role: BusinessResponse["role"]): Promise<BusinessResponse> {
    const info = await businessPlan(deps, business);
    return { business: businessDto(business), role, seats: info.seats, billingStatus: info.billingStatus };
  }

  /** Feature of the business plan (Affaires / Affaires Pro), else 403 plan_required. */
  async function requireFeature(business: BusinessRow, feature: Feature) {
    const { features } = await getFeatures(repo, business.telecomAccountId);
    if (!features.has(feature)) throw forbidden("plan_required", `This needs a plan with ${feature}`);
  }

  /** A number held by the business's telecom account. */
  async function businessNumber(business: BusinessRow, e164: string) {
    const n = await repo.getNumberByE164(e164);
    if (!n || n.telecomAccountId !== business.telecomAccountId || !HELD_STATES.has(n.state)) {
      throw badRequest("number_not_in_business", "This number is not held by the business");
    }
    return n;
  }

  /** Extension/ring-group numbers share one dial plan. */
  async function assertDialable(businessId: string, number: string, self?: { extensionId?: string; ringGroupId?: string }) {
    const ext = await pbx.findExtensionByNumber(businessId, number);
    if (ext && ext.id !== self?.extensionId) throw conflict("extension_number_taken");
    const group = (await pbx.listRingGroups(businessId)).find((g) => g.number === number);
    if (group && group.id !== self?.ringGroupId) throw conflict("extension_number_taken");
  }

  async function assertMemberUser(businessId: string, userId: string | null | undefined) {
    if (!userId) return;
    if (!(await pbx.getMembership(businessId, userId))) throw badRequest("user_not_member", "The user is not an active member of the business");
  }

  async function ownExtension(ctx: BusinessContext, extId: string): Promise<ExtensionRow> {
    const ext = await pbx.getExtension(extId);
    if (!ext || ext.businessId !== ctx.business.id) throw notFound();
    return ext;
  }

  // ------------------------------------------------------------------------------- businesses

  app.get("/v1/business", auth, async (req): Promise<BusinessesResponse> => {
    const { user } = await loadContext(deps, req);
    const list = await pbx.listBusinessesForUser(user.id);
    return { businesses: await Promise.all(list.map((m) => response(m.business, m.member.role))) };
  });

  app.post("/v1/business", auth, async (req, reply) => {
    const body = parse(CreateBusinessBody, req.body);
    const { user, account } = await loadContext(deps, req);
    // The TAKATAK business id comes from the signed handoff (stored on the account by /v1/handoff/claim).
    if (body.takatakBusinessId && body.takatakBusinessId !== account.businessId) throw forbidden("takatak_business_mismatch");
    if (await pbx.getBusinessByAccount(account.id)) throw conflict("business_exists", "This account already has a business");
    const business = await pbx.createBusiness({
      name: body.name,
      takatakBusinessId: body.takatakBusinessId ?? null,
      telecomAccountId: account.id,
      mainNumber: null,
      locale: body.locale ?? user.locale,
    });
    await pbx.addMember({ businessId: business.id, userId: user.id, email: user.email, role: "owner", status: "active", invitedBy: null });
    if (account.kind !== "business") await repo.updateAccount(account.id, { kind: "business" });
    await repo.audit({ actorUserId: user.id, action: "business.created", targetType: "business", targetId: business.id, ip: req.ip });
    return reply.code(201).send(await response(business, "owner"));
  });

  app.get("/v1/business/:id", auth, async (req): Promise<BusinessResponse> => {
    const ctx = await businessAccess(deps, req);
    return response(ctx.business, ctx.member.role);
  });

  app.patch("/v1/business/:id", auth, async (req): Promise<BusinessResponse> => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(UpdateBusinessBody, req.body);
    if (body.mainNumber) await businessNumber(ctx.business, body.mainNumber);
    const updated = await pbx.updateBusiness(ctx.business.id, body);
    await audit(ctx, req, "business.updated", ctx.business.id);
    return response(updated, ctx.member.role);
  });

  app.put("/v1/business/:id/recording-policy", auth, async (req): Promise<BusinessResponse> => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(RecordingPolicyBody, req.body);
    if (body.mode !== "off") await requireFeature(ctx.business, "call_recording");
    const current = ctx.business.recordingPolicy;
    const updated = await pbx.updateBusiness(ctx.business.id, {
      recordingPolicy: {
        mode: body.mode,
        consentPrompt: body.consentPrompt ?? current.consentPrompt,
        retentionDays: body.retentionDays ?? current.retentionDays,
      },
    });
    await audit(ctx, req, "business.recording_policy", ctx.business.id, { mode: body.mode });
    return response(updated, ctx.member.role);
  });

  // ---------------------------------------------------------------------------------- members

  app.get("/v1/business/:id/members", auth, async (req): Promise<MembersResponse> => {
    const ctx = await businessAccess(deps, req);
    return { members: (await pbx.listMembers(ctx.business.id)).map(memberDto) };
  });

  app.post("/v1/business/:id/members", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(InviteBody, req.body);
    if (await pbx.findMemberByEmail(ctx.business.id, body.email)) throw conflict("member_exists");
    const member = await pbx.addMember({
      businessId: ctx.business.id,
      userId: null,
      email: body.email.toLowerCase(),
      role: body.role,
      status: "invited",
      invitedBy: ctx.user.id,
    });
    await audit(ctx, req, "business.member_invited", member.id, { role: body.role });
    return reply.code(201).send(memberDto(member));
  });

  app.patch("/v1/business/:id/members/:memberId", auth, async (req) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { memberId } = parse(Sub("memberId"), req.params);
    const body = parse(z.object({ role: Role }), req.body);
    const m = await pbx.getMember(memberId);
    if (!m || m.businessId !== ctx.business.id) throw notFound();
    if (m.role === "owner") throw forbidden("owner_immutable", "The owner's role cannot be changed");
    // Only the owner promotes to or demotes from admin.
    if ((m.role === "admin" || body.role === "admin") && ctx.member.role !== "owner") throw forbidden("business_role_required", "Requires the owner role");
    const updated = await pbx.updateMember(m.id, { role: body.role });
    await audit(ctx, req, "business.member_role", m.id, { role: body.role });
    return memberDto(updated);
  });

  app.delete("/v1/business/:id/members/:memberId", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { memberId } = parse(Sub("memberId"), req.params);
    const m = await pbx.getMember(memberId);
    if (!m || m.businessId !== ctx.business.id) throw notFound();
    if (m.role === "owner") throw forbidden("owner_immutable", "The owner cannot be removed");
    if (m.role === "admin" && ctx.member.role !== "owner") throw forbidden("business_role_required", "Requires the owner role");
    await pbx.deleteMember(m.id);
    // Their extensions stop ringing them (the boxes and numbers stay with the business).
    if (m.userId) {
      for (const e of await pbx.listExtensions(ctx.business.id)) if (e.userId === m.userId) await pbx.updateExtension(e.id, { userId: null });
    }
    await audit(ctx, req, "business.member_removed", m.id);
    return reply.code(204).send();
  });

  app.post("/v1/business/invites/claim", auth, async (req): Promise<ClaimInvitesResponse> => {
    const { user } = await loadContext(deps, req);
    if (!user.email) return { claimed: [] };
    const claimed = await pbx.claimInvites(user.id, user.email, deps.now());
    for (const m of claimed) await repo.audit({ actorUserId: user.id, action: "business.invite_claimed", targetType: "business", targetId: m.businessId, ip: req.ip });
    return { claimed: claimed.map((m) => ({ businessId: m.businessId, memberId: m.id, role: m.role })) };
  });

  // ------------------------------------------------------------------------------- extensions

  app.get("/v1/business/:id/extensions", auth, async (req): Promise<ExtensionsResponse> => {
    const ctx = await businessAccess(deps, req);
    return { extensions: (await pbx.listExtensions(ctx.business.id)).map(extensionDto) };
  });

  app.post("/v1/business/:id/extensions", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(ExtensionBody, req.body);
    await assertDialable(ctx.business.id, body.number);
    await assertMemberUser(ctx.business.id, body.userId);
    if (body.did) await businessNumber(ctx.business, body.did);
    if (body.forwardToMobile) assertForwardable(body.forwardToMobile);
    const ext = await pbx.createExtension({
      businessId: ctx.business.id,
      number: body.number,
      displayName: body.displayName,
      userId: body.userId ?? null,
      voicemail: body.voicemail ?? { enabled: true, greeting: null },
      forwardToMobile: body.forwardToMobile ?? null,
      did: body.did ?? null,
      ringTimeoutS: body.ringTimeoutS ?? 25,
    });
    await audit(ctx, req, "business.extension_created", ext.id);
    return reply.code(201).send(extensionDto(ext));
  });

  app.patch("/v1/business/:id/extensions/:extId", auth, async (req) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { extId } = parse(Sub("extId"), req.params);
    const ext = await ownExtension(ctx, extId);
    const body = parse(ExtensionBody.partial(), req.body);
    if (body.number && body.number !== ext.number) await assertDialable(ctx.business.id, body.number, { extensionId: ext.id });
    await assertMemberUser(ctx.business.id, body.userId);
    if (body.did) await businessNumber(ctx.business, body.did);
    if (body.forwardToMobile) assertForwardable(body.forwardToMobile);
    const updated = await pbx.updateExtension(ext.id, body);
    await audit(ctx, req, "business.extension_updated", ext.id);
    return extensionDto(updated);
  });

  app.delete("/v1/business/:id/extensions/:extId", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { extId } = parse(Sub("extId"), req.params);
    const ext = await ownExtension(ctx, extId);
    await pbx.deleteExtension(ext.id);
    await audit(ctx, req, "business.extension_deleted", ext.id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------------------ ring groups

  async function ringGroupFields(ctx: BusinessContext, body: z.infer<typeof RingGroupBody>, self?: string) {
    if (body.number) await assertDialable(ctx.business.id, body.number, self ? { ringGroupId: self } : undefined);
    for (const id of body.memberExtensionIds) await ownExtension(ctx, id).catch(() => Promise.reject(badRequest("invalid_target", "Unknown extension")));
    await assertTarget(deps, ctx.business.id, body.overflow);
    if (self && body.overflow?.type === "ring_group" && body.overflow.ringGroupId === self) throw badRequest("invalid_target", "A ring group cannot overflow to itself");
    return {
      name: body.name,
      number: body.number ?? null,
      strategy: body.strategy,
      memberExtensionIds: [...new Set(body.memberExtensionIds)],
      timeoutS: body.timeoutS ?? 20,
      overflow: body.overflow ?? null,
    };
  }

  app.get("/v1/business/:id/ring-groups", auth, async (req): Promise<RingGroupsResponse> => {
    const ctx = await businessAccess(deps, req);
    return { ringGroups: (await pbx.listRingGroups(ctx.business.id)).map(ringGroupDto) };
  });

  app.post("/v1/business/:id/ring-groups", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    await requireFeature(ctx.business, "ring_groups");
    const fields = await ringGroupFields(ctx, parse(RingGroupBody, req.body));
    const group = await pbx.createRingGroup({ businessId: ctx.business.id, ...fields });
    await audit(ctx, req, "business.ring_group_created", group.id);
    return reply.code(201).send(ringGroupDto(group));
  });

  app.put("/v1/business/:id/ring-groups/:rgId", auth, async (req) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { rgId } = parse(Sub("rgId"), req.params);
    const group = await pbx.getRingGroup(rgId);
    if (!group || group.businessId !== ctx.business.id) throw notFound();
    const fields = await ringGroupFields(ctx, parse(RingGroupBody, req.body), group.id);
    const updated = await pbx.updateRingGroup(group.id, fields);
    await audit(ctx, req, "business.ring_group_updated", group.id);
    return ringGroupDto(updated);
  });

  app.delete("/v1/business/:id/ring-groups/:rgId", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { rgId } = parse(Sub("rgId"), req.params);
    const group = await pbx.getRingGroup(rgId);
    if (!group || group.businessId !== ctx.business.id) throw notFound();
    await pbx.deleteRingGroup(group.id);
    await audit(ctx, req, "business.ring_group_deleted", group.id);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------------------- IVR

  async function ivrFields(ctx: BusinessContext, body: z.infer<typeof IvrBody>) {
    for (const o of body.options) await assertTarget(deps, ctx.business.id, o.target);
    await assertTarget(deps, ctx.business.id, body.timeoutTarget);
    await assertTarget(deps, ctx.business.id, body.invalidTarget);
    return {
      name: body.name,
      greeting: body.greeting,
      greetingRecordingUrl: body.greetingRecordingUrl ?? null,
      options: body.options,
      timeoutS: body.timeoutS ?? 6,
      maxRetries: body.maxRetries ?? 2,
      timeoutTarget: body.timeoutTarget ?? null,
      invalidTarget: body.invalidTarget ?? null,
    };
  }

  app.get("/v1/business/:id/ivr", auth, async (req): Promise<IvrMenusResponse> => {
    const ctx = await businessAccess(deps, req);
    return { menus: (await pbx.listIvrMenus(ctx.business.id)).map(ivrDto) };
  });

  app.post("/v1/business/:id/ivr", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    await requireFeature(ctx.business, "auto_attendant");
    const menu = await pbx.createIvrMenu({ businessId: ctx.business.id, ...(await ivrFields(ctx, parse(IvrBody, req.body))) });
    await audit(ctx, req, "business.ivr_created", menu.id);
    return reply.code(201).send(ivrDto(menu));
  });

  app.put("/v1/business/:id/ivr/:menuId", auth, async (req) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { menuId } = parse(Sub("menuId"), req.params);
    const menu = await pbx.getIvrMenu(menuId);
    if (!menu || menu.businessId !== ctx.business.id) throw notFound();
    const updated = await pbx.updateIvrMenu(menu.id, await ivrFields(ctx, parse(IvrBody, req.body)));
    await audit(ctx, req, "business.ivr_updated", menu.id);
    return ivrDto(updated);
  });

  app.delete("/v1/business/:id/ivr/:menuId", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { menuId } = parse(Sub("menuId"), req.params);
    const menu = await pbx.getIvrMenu(menuId);
    if (!menu || menu.businessId !== ctx.business.id) throw notFound();
    await pbx.deleteIvrMenu(menu.id);
    await audit(ctx, req, "business.ivr_deleted", menu.id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------------------------ hours

  app.get("/v1/business/:id/hours", auth, async (req): Promise<BusinessHoursResponse> => {
    const ctx = await businessAccess(deps, req);
    const hours = (await pbx.getHours(ctx.business.id)) ?? defaultHours(ctx.business.id);
    return { hours, open: isOpen(hours, deps.now()) };
  });

  app.put("/v1/business/:id/hours", auth, async (req): Promise<BusinessHoursResponse> => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(HoursBody, req.body);
    // "schedule" here would loop back into the hours.
    await assertTarget(deps, ctx.business.id, body.openTarget);
    await assertTarget(deps, ctx.business.id, body.closedTarget);
    const hours = await pbx.putHours({ businessId: ctx.business.id, timezone: BUSINESS_TIMEZONE, ...body });
    await audit(ctx, req, "business.hours_updated", ctx.business.id);
    return { hours, open: isOpen(hours, deps.now()) };
  });

  // ------------------------------------------------------------------------------------- DIDs

  app.get("/v1/business/:id/dids", auth, async (req): Promise<DidRoutesResponse> => {
    const ctx = await businessAccess(deps, req);
    return { routes: (await pbx.listDidRoutes(ctx.business.id)).map(didDto) };
  });

  app.put("/v1/business/:id/dids", auth, async (req) => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(DidBody, req.body);
    const number = await businessNumber(ctx.business, body.e164);
    await assertTarget(deps, ctx.business.id, body.target, { allowSchedule: true });
    const route = await pbx.upsertDidRoute({ businessId: ctx.business.id, phoneNumberId: number.id, e164: number.e164, target: body.target });
    await audit(ctx, req, "business.did_routed", route.id, { e164: number.e164, target: body.target.type });
    return didDto(route);
  });

  app.delete("/v1/business/:id/dids/:routeId", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { routeId } = parse(Sub("routeId"), req.params);
    const route = await pbx.getDidRoute(routeId);
    if (!route || route.businessId !== ctx.business.id) throw notFound();
    await pbx.deleteDidRoute(route.id);
    await audit(ctx, req, "business.did_unrouted", route.id);
    return reply.code(204).send();
  });

  /** A new business number: same checks as /v1/numbers/claim, limit 1 + seats + extra numbers, routed by schedule. */
  app.post("/v1/business/:id/numbers/claim", auth, async (req, reply) => {
    const ctx = await businessAccess(deps, req, "admin");
    const { e164 } = parse(z.object({ e164: z.string().regex(NANP_E164) }), req.body);
    const info = await businessPlan(deps, ctx.business);
    if (!info.active) throw forbidden("plan_required", "A business plan is required");
    const account = info.account;
    if (!account || outboundBlocked(account)) throw forbidden("account_restricted");
    const e911 = await e911Ready(deps, ctx.user.id, account.id);
    if (!e911.address) throw forbidden("e911_address_required", "Register the business 9-1-1 civic address first");
    if (!e911.ack) throw forbidden("e911_ack_required", "Accept the current 9-1-1 notice first");
    if (classifyDestination(e164) !== "ca") throw forbidden("canadian_numbers_only");
    const { extraNumbers } = await getFeatures(repo, account.id);
    const held = (await repo.listNumbersByAccount(account.id)).filter((n) => HELD_STATES.has(n.state));
    if (held.length >= 1 + info.seats + extraNumbers) throw forbidden("number_limit_reached", "Add a line to get another number");
    const existing = await repo.getNumberByE164(e164);
    if (existing && existing.state !== "released") throw conflict("number_unavailable");
    if (!deps.twilio) throw notConfigured("Number purchase");

    const address = await repo.getE911Address(account.id);
    const purchased = await deps.twilio.purchaseNumber({
      e164,
      voiceUrl: `${base}/webhooks/twilio/voice/inbound`,
      smsUrl: `${base}/webhooks/twilio/sms/inbound`,
      statusCallback: `${base}/webhooks/twilio/voice/status`,
      ...(address?.providerRef ? { emergencyAddressSid: address.providerRef } : {}),
    });
    const now = deps.now();
    const fields = {
      twilioSid: purchased.sid,
      telecomAccountId: account.id,
      kind: "local" as const,
      state: "active" as const,
      lastActivityAt: now,
      stateChangedAt: now,
      quarantineUntil: null,
      warningsSent: [],
    };
    const number = existing ? await repo.updateNumber(existing.id, fields) : await repo.createNumber({ e164, ...fields });
    await pbx.upsertDidRoute({ businessId: ctx.business.id, phoneNumberId: number.id, e164, target: { type: "schedule" } });
    if (!ctx.business.mainNumber) await pbx.updateBusiness(ctx.business.id, { mainNumber: e164 });
    await audit(ctx, req, "business.number_claimed", number.id, { e164 });
    await repo.enqueueOutbox("phone_number.assigned", {
      phone_number_id: number.id,
      e164,
      telecom_account_id: account.id,
      global_user_id: ctx.user.globalUserId,
      workspace_id: account.workspaceId,
    });
    const res: ClaimNumberResponse = { id: number.id, e164: number.e164, state: number.state };
    return reply.code(201).send(res);
  });

  // ------------------------------------------------------------------------- calls, recordings

  app.get("/v1/business/:id/calls", auth, async (req): Promise<BusinessCallsResponse> => {
    const ctx = await businessAccess(deps, req);
    const q = parse(PageQuery, req.query);
    const before = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await pbx.listBusinessCalls(ctx.business.telecomAccountId, {
      limit: q.limit + 1,
      ...(isAdmin(ctx.member) ? {} : { userId: ctx.user.id }),
      ...(before ? { before: { startedAt: before.at, id: before.id } } : {}),
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { calls: page.map(callDto), nextCursor: rows.length > q.limit && last ? encodeCursor(last.startedAt, last.id) : null };
  });

  app.get("/v1/business/:id/recordings", auth, async (req): Promise<BusinessRecordingsResponse> => {
    const ctx = await businessAccess(deps, req);
    const rows = await pbx.listRecordings(ctx.business.id, { limit: 100, ...(isAdmin(ctx.member) ? {} : { userId: ctx.user.id }) });
    const summaries = await pbx.getCallSummaries(rows.map((r) => r.id));
    const recordings = await Promise.all(
      rows.map(async (r): Promise<BusinessRecordingDto> => {
        const signed = await deps.sessions.signMedia(recordingResource(r.id), RECORDING_URL_TTL_S);
        return {
          id: r.id,
          businessId: r.businessId,
          callSid: r.callSid,
          extensionId: r.extensionId,
          source: r.source,
          fromNumber: r.fromNumber,
          toNumber: r.toNumber,
          durationS: r.durationS,
          createdAt: r.createdAt.toISOString(),
          deleteAfter: r.deleteAfter.toISOString(),
          audioUrl: `${base}/v1/business/${ctx.business.id}/recordings/${r.id}/audio?token=${encodeURIComponent(signed.token)}`,
          audioUrlExpiresAt: signed.expiresAt.toISOString(),
          summary: callSummaryDto(deps, summaries.get(r.id)),
        };
      }),
    );
    return { recordings };
  });

  // Signed link from the list (players cannot send headers). Streams from Twilio; credentials stay here.
  app.get("/v1/business/:id/recordings/:recId/audio", async (req, reply) => {
    const { id, recId } = parse(Sub("recId"), req.params);
    const { token } = parse(z.object({ token: z.string().max(2048) }), req.query);
    if (!(await deps.sessions.verifyMedia(token, recordingResource(recId)))) throw new HttpError(403, "invalid_media_token", "Audio link expired or invalid");
    const rec = await pbx.getRecording(recId);
    if (!rec || rec.businessId !== id) throw notFound();
    if (!deps.twilio) throw notConfigured("Recording audio");
    try {
      const accountSid = recordingAccountSid(rec.recordingUrl);
      const audio = await deps.twilio.fetchRecording({ recordingSid: rec.recordingSid, ...(accountSid ? { accountSid } : {}) });
      return reply.header("content-type", audio.contentType).header("cache-control", "private, no-store").send(audio.body);
    } catch (err) {
      req.log.error({ err, recordingId: rec.id }, "business recording fetch failed");
      throw new HttpError(502, "audio_unavailable", "The recording could not be retrieved");
    }
  });

  // ------------------------------------------------------------------------------ usage, seats

  app.get("/v1/business/:id/usage", auth, async (req): Promise<BusinessUsageResponse> => {
    const ctx = await businessAccess(deps, req, "admin");
    const info = await businessPlan(deps, ctx.business);
    const now = deps.now();
    const period = monthPeriod(now);
    const periodStart = `${period}-01T00:00:00.000Z`;
    const caps = planOf(info.active ? info.plan : "business").caps;
    const [usage, byUser] = await Promise.all([
      repo.getUsage(ctx.business.telecomAccountId, period),
      pbx.minutesByUser(ctx.business.telecomAccountId, new Date(periodStart)),
    ]);
    const s = info.seats;
    return {
      plan: info.active ? (info.plan as BusinessUsageResponse["plan"]) : null,
      seats: s,
      periodStart,
      perLine: { outboundMinutes: caps.outboundMinutes, inboundMinutes: caps.inboundMinutes, messages: caps.messages, concurrentCalls: caps.concurrentCalls },
      pooled: {
        outboundMinutes: { used: usage.minutesOut, cap: caps.outboundMinutes * s + usage.bonusMinutesOut },
        inboundMinutes: { used: usage.minutesIn, cap: caps.inboundMinutes * s },
        messages: { used: usage.smsOut + usage.smsIn, cap: caps.messages * s },
        concurrentCalls: { cap: caps.concurrentCalls * s },
      },
      byUser,
    };
  });

  /**
   * Seats (lines), PBX-01. Owner/admin. Stripe is the source of truth: this changes the quantity of the
   * business subscription (prorated, idempotent) and mirrors it; the customer.subscription.updated webhook
   * confirms it. No subscription yet → a Stripe Checkout URL with quantity = count (seats sync on payment).
   * Never below the lines in use (one per extension).
   */
  app.post("/v1/business/:id/seats", auth, async (req): Promise<SeatsResponse> => {
    const ctx = await businessAccess(deps, req, "admin");
    const { count, plan } = parse(
      z.object({ count: z.number().int().min(1).max(500), plan: z.enum(["business", "business_pro"]).optional() }),
      req.body,
    );
    const clientKey = req.headers["idempotency-key"];
    if (clientKey !== undefined && (typeof clientKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(clientKey))) {
      throw badRequest("invalid_idempotency_key", "Clé d'idempotence invalide (8 à 128 caractères A-Z, a-z, 0-9, _ ou -).");
    }
    const inUse = (await pbx.listExtensions(ctx.business.id)).length;
    if (count < inUse) {
      throw conflict(
        "seats_below_members",
        `Impossible de passer à ${count} ligne${count > 1 ? "s" : ""} : ${inUse} postes utilisent une ligne. Retirez des postes avant de retirer des lignes.`,
      );
    }
    if (!deps.billing) throw notConfigured("Billing");
    const account = await repo.getAccount(ctx.business.telecomAccountId);
    if (!account) throw notFound();
    const sub = businessSubscription(await repo.listSubscriptions(account.id));
    const live = sub && isLiveSubscription(sub) ? sub : null;

    if (!live) {
      const session = await createPlanCheckout(deps, { account, user: ctx.user, plan: plan ?? "business", quantity: count });
      await audit(ctx, req, "business.seats_checkout", ctx.business.id, { count, plan: plan ?? "business" });
      return { seats: (await pbx.getSeats(ctx.business.id)).seats, checkoutUrl: session.url, billingStatus: sub?.status ?? null };
    }
    if (live.source !== "stripe" || !live.stripeSubscriptionId) {
      throw conflict("seats_not_stripe", "Les lignes de ce forfait ne se gèrent pas par Stripe. Communiquez avec le soutien MIMT.");
    }
    if (count !== live.quantity) {
      const idempotencyKey = `seats:${ctx.business.id}:${live.stripeSubscriptionId}:${live.quantity}-${count}:${clientKey ?? randomUUID()}`;
      try {
        await deps.billing.updateSeatQuantity({
          subscriptionId: live.stripeSubscriptionId,
          quantity: count,
          prorationBehavior: "create_prorations",
          idempotencyKey,
          locale: ctx.user.locale,
        });
      } catch (err) {
        req.log.error({ err, businessId: ctx.business.id }, "Stripe seat update failed");
        throw new HttpError(502, "billing_unavailable", "La facturation n'a pas pu modifier le nombre de lignes. Réessayez plus tard.");
      }
      await repo.upsertSubscription({
        telecomAccountId: live.telecomAccountId,
        kind: live.kind,
        code: live.code,
        quantity: count,
        stripeSubscriptionId: live.stripeSubscriptionId,
        status: live.status,
        source: live.source,
        currentPeriodEnd: live.currentPeriodEnd,
      });
    }
    const seats = await pbx.setSeats(ctx.business.id, count, live.stripeSubscriptionId);
    await audit(ctx, req, "business.seats", ctx.business.id, { count, previous: live.quantity });
    return { seats: seats.seats, billingStatus: live.status };
  });

  // --------------------------------------------------------------------- on-demand recording

  app.post("/v1/calls/:sid/recording", auth, async (req): Promise<CallRecordingResponse> => {
    const { sid } = parse(z.object({ sid: z.string().regex(/^CA[0-9a-f]{32}$/i) }), req.params);
    const { action } = parse(z.object({ action: z.enum(["start", "stop"]) }), req.body);
    const { user } = await loadContext(deps, req);
    const call = await repo.getCallBySid(sid);
    // Own calls only; the business's policy must allow on-demand recording (Affaires Pro).
    if (!call || call.userId !== user.id || !call.telecomAccountId || call.kind === "emergency") throw notFound();
    const business = await pbx.getBusinessByAccount(call.telecomAccountId);
    if (!business || !(await pbx.getMembership(business.id, user.id))) throw notFound();
    if (business.recordingPolicy.mode === "off") throw forbidden("recording_disabled");
    await requireFeature(business, "call_recording");
    if (!deps.twilio?.updateCallRecording) throw notConfigured("Call recording");
    const ext = (await pbx.listExtensionsByUser(user.id)).find((e) => e.businessId === business.id);
    await deps.twilio.updateCallRecording({
      callSid: sid,
      action,
      statusCallback: `${base}/webhooks/twilio/pbx/recording?${new URLSearchParams({ b: business.id, s: "on_demand", ...(ext ? { x: ext.id } : {}) })}`,
    });
    await repo.audit({ actorUserId: user.id, action: `call.recording_${action}`, targetType: "call", targetId: call.id, ip: req.ip });
    return { callSid: sid, recording: action === "start" ? "started" : "stopped" };
  });
}

function assertForwardable(e164: string) {
  const zone = classifyDestination(e164);
  if (zone !== "ca" && zone !== "us") throw badRequest("external_number_not_allowed", "Only Canada/US non-premium numbers can be forwarded to");
}
