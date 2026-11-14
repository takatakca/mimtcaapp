// « MIMT Connect » lot B (issue #97, points 3, 4 and 7; docs/MIMT-CONNECT.md « Statut du membre »): what a partner
// may know about the MIMT person linked to one of its members (plan status, number transfers: minimal, Law 25), and
// the member's availability for the partner's hunt groups. Routes: src/routes/partners.ts. Ring-group skipping:
// src/pbx/router.ts (dialRingGroup) fed by unavailableExtensionIds() through src/pbx/engine.ts (loadSnapshot).
// Storage: src/repo/partners*.ts (0028_partner_member_status.sql). Everything is a no-op while PARTNERS=off.
// Consent (0029): subscription.read, porting.read and availability.manage are checked on the link of a linked member
// (403 scope_not_granted, access log); webhooks of a scope are not sent without it.

import {
  type PartnerAvailabilityDto,
  type PartnerAvailabilityRequest,
  type PartnerAvailabilityStatus,
  type PartnerMemberPortInDto,
  type PartnerMemberPortInsResponse,
  type PartnerMemberSubscriptionDto,
  type PartnerMemberSubscriptionStatus,
  type PartnerScope,
  type PlanCode,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { inWeekly } from "../pbx/router.js";
import type { PortInWithNumbers } from "../repo/portIn.js";
import type { PartnerAvailabilityRow, PartnerMemberLinkRow, PartnerMemberRow, PartnerRow } from "../repo/partners.js";
import type { Subscription, TelecomAccount } from "../repo/types.js";
import { isLiveSubscription, planFromSubscriptions } from "./accounts.js";
import { chooseNumberUrl, emitPartnerEvent, partnersOn } from "./partners.js";
import { assertScope, type AccessContext } from "./partnerConsent.js";

type Log = { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

/** Longest temporary status a partner can set (`until`). */
const MAX_UNTIL_MS = 366 * 24 * 3600_000;

const base = (deps: Pick<AppDeps, "config">) => deps.config.APP_BASE_URL.replace(/\/$/, "");
const slugOf = (p: PartnerRow) => encodeURIComponent(p.slug ?? p.id);

/** Where the person chooses and pays for their plan in MIMT (Compte › Forfait). MIMT never charges on the partner's say-so. */
export const planUrl = (deps: Pick<AppDeps, "config">, p: PartnerRow) => `${base(deps)}/compte?partner=${slugOf(p)}#forfait`;
/** Where the person starts a number transfer in MIMT (Services › Transfert de numéro). */
export const portUrl = (deps: Pick<AppDeps, "config">, p: PartnerRow) => `${base(deps)}/services/transfert?partner=${slugOf(p)}`;

/** Same 409 as the lot A routes, with the « choose a number in MIMT » link; then the link must grant `scope`. */
async function activeLink(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, scope: PartnerScope, access: AccessContext): Promise<PartnerMemberLinkRow> {
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  if (!link) {
    throw new HttpError(409, "member_not_linked", "This member has not linked a MIMT account yet (link request, then approval in MIMT).", {
      chooseNumberUrl: chooseNumberUrl(deps, p),
    });
  }
  await assertScope(deps, link, scope, access);
  return link;
}

// ------------------------------------------------------------------------------------------ subscription

const STATUS_RANK: Subscription["status"][] = ["active", "trialing", "past_due"];

/**
 * The minimal view of a person's own MIMT plan: plan code (free when none is live), status, period end, and whether
 * the account can place and receive calls. Never amounts, cards or invoices.
 */
export function subscriptionView(subs: Subscription[], account: TelecomAccount | null, now: Date) {
  const plan: PlanCode = planFromSubscriptions(subs, now);
  const plans = subs.filter((s) => s.kind === "plan" && s.code !== "free");
  let status: PartnerMemberSubscriptionStatus = "none";
  let sub: Subscription | null = null;
  if (plan !== "free") {
    const live = plans.filter((s) => s.code === plan && isLiveSubscription(s, now));
    sub = live.sort((a, b) => STATUS_RANK.indexOf(a.status) - STATUS_RANK.indexOf(b.status) || (b.currentPeriodEnd?.getTime() ?? 0) - (a.currentPeriodEnd?.getTime() ?? 0))[0] ?? null;
    status = (sub?.status as PartnerMemberSubscriptionStatus | undefined) ?? "active";
  } else {
    // No live plan: « canceled » when one existed (ended, unpaid or lapsed), « none » when never bought (or only an
    // unfinished checkout).
    sub = plans.reduce<Subscription | null>((best, s) => (!best || s.createdAt.getTime() >= best.createdAt.getTime() ? s : best), null);
    status = !sub || sub.status === "incomplete" ? "none" : "canceled";
  }
  return {
    plan,
    status,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    canCall: Boolean(account && account.status !== "SUSPENDED" && account.status !== "CLOSED"),
  };
}

async function viewForUser(deps: AppDeps, userId: string) {
  const account = await deps.repo.getAccountByOwner(userId);
  const subs = account ? await deps.repo.listSubscriptions(account.id) : [];
  return subscriptionView(subs, account, deps.now());
}

type View = ReturnType<typeof subscriptionView>;
/** What member.subscription_changed dedupes on: plan, status and the ability to call (not each renewal). */
const stateKey = (v: View) => `${v.plan}|${v.status}|${v.canCall ? 1 : 0}`;

/** GET /v1/partner/members/:externalId/subscription (an active link is required). */
export async function memberSubscription(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, access: AccessContext): Promise<PartnerMemberSubscriptionDto> {
  const link = await activeLink(deps, p, m, "subscription.read", access);
  const v = await viewForUser(deps, link.userId);
  return { plan: v.plan, status: v.status, currentPeriodEnd: v.currentPeriodEnd?.toISOString() ?? null, canCall: v.canCall, planUrl: planUrl(deps, p) };
}

/** Called when a link is approved: the current view is the baseline, so the next real change is what gets sent. */
export async function rememberSubscriptionState(deps: AppDeps, link: PartnerMemberLinkRow) {
  await deps.repo.partners.swapLinkSubscriptionState(link.id, stateKey(await viewForUser(deps, link.userId)));
}

/**
 * After a plan subscription row of `account` was written (Stripe, App Store, Google Play webhooks; routes/billing.ts):
 * for each active partner link of the account's owner, member.subscription_changed when plan, status or the ability
 * to call changed since the last one sent. Never throws (billing webhooks must not fail on a partner).
 */
export async function notifyMemberSubscription(deps: AppDeps, account: TelecomAccount, log?: Log) {
  if (!partnersOn(deps)) return;
  try {
    const links = await deps.repo.partners.listActiveLinksByUser(account.ownerUserId);
    if (!links.length) return;
    const subs = await deps.repo.listSubscriptions(account.id);
    const v = subscriptionView(subs, await deps.repo.getAccount(account.id), deps.now());
    for (const link of links) {
      const [p, m] = await Promise.all([deps.repo.partners.getPartner(link.partnerId), deps.repo.partners.getMemberById(link.memberId)]);
      if (!p || p.status !== "active" || !m) continue;
      if (!(await deps.repo.partners.swapLinkSubscriptionState(link.id, stateKey(v)))) continue;
      await emitPartnerEvent(
        deps,
        p,
        "member.subscription_changed",
        { member_external_id: m.externalId, plan: v.plan, status: v.status, current_period_end: v.currentPeriodEnd?.toISOString() ?? null, can_call: v.canCall },
        { linkId: link.id },
      );
    }
  } catch (err) {
    log?.error({ err: err instanceof Error ? err.message : String(err), accountId: account.id }, "partner subscription hook failed");
  }
}

// -------------------------------------------------------------------------------------------- port-ins

/** Minimal port-in view: never the carrier account number, PIN, LOA signature, address or names. */
export function memberPortInDto({ request: r, numbers }: PortInWithNumbers): PartnerMemberPortInDto {
  const foc = numbers.map((n) => n.focDate).filter((d): d is string => Boolean(d)).sort()[0];
  return {
    id: r.id,
    e164: numbers[0]?.e164 ?? "",
    numbers: numbers.map((n) => ({ e164: n.e164, status: n.status })),
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
    expectedDate: foc ?? r.desiredDate ?? null,
  };
}

/** GET /v1/partner/members/:externalId/port-ins: the linked person's own transfers, newest first. */
export async function memberPortIns(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, access: AccessContext): Promise<PartnerMemberPortInsResponse> {
  const link = await activeLink(deps, p, m, "porting.read", access);
  const account = await deps.repo.getAccountByOwner(link.userId);
  const rows = account ? await deps.repo.portIns.listByAccounts([account.id]) : [];
  const own = rows.filter((x) => x.request.telecomAccountId === account?.id).sort((a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime());
  return { portIns: own.map(memberPortInDto), portUrl: portUrl(deps, p) };
}

/** What member.port_in_updated dedupes on: the request status and each number's status and dates. */
export const portInFingerprint = (p: PortInWithNumbers | null) =>
  p ? JSON.stringify([p.request.status, p.request.desiredDate, p.numbers.map((n) => [n.e164, n.status, n.focDate])]) : "";

/**
 * After a port-in changed (signature, submission, Twilio webhook, cancellation; routes/portIns.ts): when its
 * status or a number's status or date moved, member.port_in_updated to every active partner link of the account's
 * owner. Never throws.
 */
export async function notifyMemberPortIn(deps: AppDeps, before: PortInWithNumbers | null, after: PortInWithNumbers, log?: Log) {
  if (!partnersOn(deps) || portInFingerprint(before) === portInFingerprint(after)) return;
  try {
    const account = await deps.repo.getAccount(after.request.telecomAccountId);
    if (!account) return;
    const dto = memberPortInDto(after);
    for (const link of await deps.repo.partners.listActiveLinksByUser(account.ownerUserId)) {
      const [p, m] = await Promise.all([deps.repo.partners.getPartner(link.partnerId), deps.repo.partners.getMemberById(link.memberId)]);
      if (!p || p.status !== "active" || !m) continue;
      await emitPartnerEvent(
        deps,
        p,
        "member.port_in_updated",
        {
          member_external_id: m.externalId,
          port_in_id: dto.id,
          e164: dto.e164,
          numbers: dto.numbers,
          status: dto.status,
          updated_at: dto.updatedAt,
          expected_date: dto.expectedDate,
        },
        { linkId: link.id },
      );
    }
  } catch (err) {
    log?.error({ err: err instanceof Error ? err.message : String(err), portInId: after.request.id }, "partner port-in hook failed");
  }
}

// ---------------------------------------------------------------------------------------- availability

/**
 * Who rings right now. Rules, in order (docs/MIMT-CONNECT.md « Disponibilité »):
 *  1. no row: available (members ring as before lot B);
 *  2. the linked person's own status, when set, replaces the partner's status (and its `until`);
 *  3. otherwise the partner's status, until `until` (after it: available again);
 *  4. an « available » status is still bounded by the weekly windows (America/Montreal): outside them, offline.
 */
export function effectiveAvailability(a: PartnerAvailabilityRow | null, at: Date): { status: PartnerAvailabilityStatus; source: PartnerAvailabilityDto["source"] } {
  if (!a) return { status: "available", source: "default" };
  let decided: { status: PartnerAvailabilityStatus; source: PartnerAvailabilityDto["source"] };
  if (a.userStatus) decided = { status: a.userStatus, source: "user" };
  else if (a.until && a.until.getTime() <= at.getTime()) decided = { status: "available", source: "default" };
  else decided = { status: a.status, source: "partner" };
  if (decided.status === "available" && a.weekly && !inWeekly(a.weekly, at)) return { status: "offline", source: "schedule" };
  return decided;
}

/** `linked: false`: the person's own status is not shown (it belongs to a MIMT account no longer linked). */
export function availabilityDto(m: PartnerMemberRow, a: PartnerAvailabilityRow | null, at: Date, opts: { linked?: boolean } = {}): PartnerAvailabilityDto {
  const eff = effectiveAvailability(a, at);
  return {
    externalId: m.externalId,
    status: a?.status ?? "available",
    weekly: a?.weekly ?? null,
    until: a?.until?.toISOString() ?? null,
    userStatus: opts.linked === false ? null : (a?.userStatus ?? null),
    effectiveStatus: eff.status,
    source: eff.source,
    updatedAt: a?.updatedAt.toISOString() ?? null,
  };
}

const availabilityKey = (a: PartnerAvailabilityRow | null) => JSON.stringify([a?.status ?? "available", a?.weekly ?? null, a?.until?.getTime() ?? null, a?.userStatus ?? null]);

async function availabilityChanged(deps: AppDeps, p: PartnerRow, m: PartnerMemberRow, after: PartnerAvailabilityRow, by: "partner" | "user", linkId: string | null) {
  const eff = effectiveAvailability(after, deps.now());
  await emitPartnerEvent(
    deps,
    p,
    "member.availability_changed",
    {
      member_external_id: m.externalId,
      effective_status: eff.status,
      source: eff.source,
      partner_status: after.status,
      user_status: after.userStatus,
      until: after.until?.toISOString() ?? null,
      has_schedule: Boolean(after.weekly),
      changed_by: by,
    },
    { linkId },
  );
}

/**
 * A member linked to a MIMT account: availability.manage is required (the setting decides when the person's apps
 * ring). A member without a link is the partner's own roster (its cellphone): no consent applies.
 */
async function availabilityLink(deps: AppDeps, m: PartnerMemberRow, access: AccessContext): Promise<PartnerMemberLinkRow | null> {
  const link = await deps.repo.partners.getActiveLinkByMember(m.id);
  if (link) await assertScope(deps, link, "availability.manage", access);
  return link;
}

export async function getMemberAvailability(deps: AppDeps, m: PartnerMemberRow, access: AccessContext): Promise<PartnerAvailabilityDto> {
  const link = await availabilityLink(deps, m, access);
  return availabilityDto(m, await deps.repo.partners.getAvailability(m.id), deps.now(), { linked: Boolean(link) });
}

/** PUT /v1/partner/members/:externalId/availability: replaces the partner's setting (the person's own one is kept). */
export async function putMemberAvailability(
  deps: AppDeps,
  p: PartnerRow,
  m: PartnerMemberRow,
  body: PartnerAvailabilityRequest,
  actor: { ip: string; keyId: string } & AccessContext,
): Promise<PartnerAvailabilityDto> {
  const link = await availabilityLink(deps, m, actor);
  const now = deps.now();
  const until = body.until ? new Date(body.until) : null;
  if (until && until.getTime() <= now.getTime()) throw badRequest("until_in_past", "`until` must be in the future");
  if (until && until.getTime() - now.getTime() > MAX_UNTIL_MS) throw badRequest("until_too_far", "`until` must be within a year");
  const before = await deps.repo.partners.getAvailability(m.id);
  const after = await deps.repo.partners.upsertAvailability(p.id, m.id, { status: body.status, weekly: body.weekly ?? null, until });
  if (availabilityKey(before) !== availabilityKey(after)) {
    await availabilityChanged(deps, p, m, after, "partner", link?.id ?? null);
    await deps.repo.audit({
      actorUserId: null,
      action: "partner.member_availability_set",
      targetType: "partner",
      targetId: p.id,
      ip: actor.ip,
      meta: { keyId: actor.keyId, memberId: m.id, status: body.status, schedule: Boolean(body.weekly), until: until?.toISOString() ?? null },
    });
  }
  return availabilityDto(m, after, now, { linked: Boolean(link) });
}

/** PUT /v1/me/partner-links/:id/availability: the linked person's own status (null gives control back to the partner). */
export async function setMyAvailability(deps: AppDeps, link: PartnerMemberLinkRow, status: PartnerAvailabilityStatus | null, actor: { userId: string; ip: string }) {
  const [p, m] = await Promise.all([deps.repo.partners.getPartner(link.partnerId), deps.repo.partners.getMemberById(link.memberId)]);
  if (!p || !m) return null;
  const before = await deps.repo.partners.getAvailability(m.id);
  const after = await deps.repo.partners.upsertAvailability(p.id, m.id, { userStatus: status });
  if (availabilityKey(before) !== availabilityKey(after)) {
    await availabilityChanged(deps, p, m, after, "user", link.id);
    await deps.repo.audit({ actorUserId: actor.userId, action: "partner.member_availability_self", targetType: "partner", targetId: p.id, ip: actor.ip, meta: { linkId: link.id, status } });
  }
  return after;
}

/** The person's own status and what applies now, for Compte › Intégrations › Partenaires. */
export async function myAvailability(deps: AppDeps, link: PartnerMemberLinkRow) {
  const a = await deps.repo.partners.getAvailability(link.memberId);
  return { userStatus: a?.userStatus ?? null, effectiveStatus: effectiveAvailability(a, deps.now()).status };
}

/**
 * Extensions of this partner's members who are not available at `at` (pbx/engine.ts loadSnapshot, partner
 * businesses with PARTNERS=on only). Members without an availability row are available.
 */
export async function unavailableExtensions(deps: AppDeps, partnerId: string, at: Date): Promise<string[]> {
  const rows = await deps.repo.partners.listAvailability(partnerId);
  if (!rows.length) return [];
  const away = new Set(rows.filter((a) => effectiveAvailability(a, at).status !== "available").map((a) => a.memberId));
  if (!away.size) return [];
  return (await deps.repo.partners.listMembers(partnerId)).filter((m) => away.has(m.id) && m.extensionId).map((m) => m.extensionId!);
}
