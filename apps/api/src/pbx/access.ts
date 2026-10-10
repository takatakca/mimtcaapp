import type { FastifyRequest } from "fastify";
import {
  isValidExtension,
  NANP_E164,
  WEEKDAYS,
  type Business,
  type BusinessMember,
  type BusinessRole,
  type DidRoute,
  type Extension,
  type IvrMenu,
  type RingGroup,
  type RouteTarget,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, type UserContext } from "../auth/guard.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import type { BusinessMemberRow, BusinessRow, DidRouteRow, ExtensionRow, IvrMenuRow, RingGroupRow } from "../repo/pbxTypes.js";
import { externalAllowed } from "./router.js";

// ---------------------------------------------------------------------------------------- access

const RANK: Record<BusinessRole, number> = { member: 0, admin: 1, owner: 2 };

export interface BusinessContext extends UserContext {
  business: BusinessRow;
  member: BusinessMemberRow;
}

/**
 * Loads the business and the caller's active membership. Not a member → 404 (no existence leak);
 * a member below `minRole` → 403 business_role_required.
 */
export async function businessAccess(deps: AppDeps, req: FastifyRequest, minRole: BusinessRole = "member"): Promise<BusinessContext> {
  const { id } = parseId(req.params);
  const ctx = await loadContext(deps, req);
  const business = await deps.repo.pbx.getBusiness(id);
  const member = business ? await deps.repo.pbx.getMembership(business.id, ctx.user.id) : null;
  if (!business || !member) throw notFound();
  if (RANK[member.role] < RANK[minRole]) throw forbidden("business_role_required", `Requires the ${minRole} role`);
  return { ...ctx, business, member };
}

export const isAdmin = (m: BusinessMemberRow) => m.role === "owner" || m.role === "admin";

function parseId(params: unknown): { id: string } {
  const r = z.object({ id: z.uuid() }).safeParse(params);
  if (!r.success) throw notFound();
  return r.data;
}

// --------------------------------------------------------------------------------------- schemas

export const Bilingual = z.object({ fr: z.string().trim().min(1).max(1000), en: z.string().trim().min(1).max(1000) });
export const Nanp = z.string().regex(NANP_E164, "Canada/US number in E.164 (+1NXXNXXXXXX)");
export const ExtensionNumber = z.string().refine(isValidExtension, "3-4 digits, not starting with 0, not an N11 or 9-1-1 code");

export const RouteTargetSchema: z.ZodType<RouteTarget> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("extension"), extensionId: z.uuid() }),
  z.object({ type: z.literal("ring_group"), ringGroupId: z.uuid() }),
  z.object({ type: z.literal("voicemail"), extensionId: z.uuid().optional(), ringGroupId: z.uuid().optional() }),
  z.object({ type: z.literal("ivr"), ivrMenuId: z.uuid() }),
  z.object({ type: z.literal("external"), number: Nanp }),
  z.object({ type: z.literal("ai_receptionist") }),
  z.object({ type: z.literal("directory") }),
  z.object({ type: z.literal("schedule") }),
  z.object({ type: z.literal("hangup") }),
]);

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "HH:MM");
const Range = z.object({ open: HHMM, close: HHMM }).refine((r) => r.open < r.close, "open must be before close");
export const WeeklySchema = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(Range).max(6)])) as Record<(typeof WEEKDAYS)[number], z.ZodArray<typeof Range>>);
export const HolidaySchema = z.object({ date: z.iso.date(), name: z.string().trim().min(1).max(80) });

// ----------------------------------------------------------------------------------- validation

/** Every id a target references must belong to this business; external numbers are NANP non-premium only. */
export async function assertTarget(deps: AppDeps, businessId: string, t: RouteTarget | null | undefined, opts: { allowSchedule?: boolean } = {}) {
  if (!t) return;
  const { pbx } = deps.repo;
  const owned = async <T extends { businessId: string }>(row: Promise<T | null>, what: string) => {
    const r = await row;
    if (!r || r.businessId !== businessId) throw badRequest("invalid_target", `Unknown ${what}`);
  };
  switch (t.type) {
    case "extension":
      return owned(pbx.getExtension(t.extensionId), "extension");
    case "ring_group":
      return owned(pbx.getRingGroup(t.ringGroupId), "ring group");
    case "ivr":
      return owned(pbx.getIvrMenu(t.ivrMenuId), "IVR menu");
    case "voicemail":
      if (t.extensionId) await owned(pbx.getExtension(t.extensionId), "extension");
      if (t.ringGroupId) await owned(pbx.getRingGroup(t.ringGroupId), "ring group");
      return;
    case "external":
      if (!externalAllowed(t.number)) throw badRequest("external_number_not_allowed", "Only Canada/US non-premium numbers can be forwarded to");
      return;
    case "schedule":
      if (!opts.allowSchedule) throw badRequest("invalid_target", "schedule is only allowed on a DID route");
      return;
    default:
      return;
  }
}

// ------------------------------------------------------------------------------------------ DTOs

const iso = (d: Date) => d.toISOString();
export const businessDto = (b: BusinessRow): Business => ({ ...b, createdAt: iso(b.createdAt) });
export const memberDto = ({ invitedBy: _i, claimedAt: _c, ...m }: BusinessMemberRow): BusinessMember => ({ ...m, createdAt: iso(m.createdAt) });
export const extensionDto = (e: ExtensionRow): Extension => ({ ...e, createdAt: iso(e.createdAt) });
export const ringGroupDto = (g: RingGroupRow): RingGroup => ({ ...g, createdAt: iso(g.createdAt) });
export const ivrDto = (m: IvrMenuRow): IvrMenu => ({ ...m, createdAt: iso(m.createdAt) });
export const didDto = (r: DidRouteRow): DidRoute => ({ ...r, createdAt: iso(r.createdAt) });
