// Glue between the Twilio voice webhooks and the pure router: loads a business's PBX snapshot,
// handles calls to business DIDs, internal extension dialing and business outbound calls.

import { PLANS, isValidExtension, type PlanCode } from "@mimt/shared";
import type twilio from "twilio";
import type { AppDeps } from "../deps.js";
import { checkInboundCaps, effectiveCaps, exceedsDailySpend } from "../fraud/caps.js";
import { checkVoiceDestination } from "../fraud/destinations.js";
import { CALL_ATTEMPT_RULES } from "../fraud/policy.js";
import { isDomesticZone, normalizeDialed } from "../lib/phone.js";
import { dayPeriod, monthPeriod } from "../lib/time.js";
import type { BusinessRow, ExtensionRow } from "../repo/pbxTypes.js";
import type { Subscription, TelecomAccount, User } from "../repo/types.js";
import { getFeatures, HELD_STATES, isLiveSubscription, outboundBlocked, setAccountStatus } from "../services/accounts.js";
import { e911Ready } from "../routes/e911.js";
import { NOT_IN_SERVICE, sayBilingual, VoiceResponse } from "../routes/twiml.js";
import * as router from "./router.js";

type VR = twilio.twiml.VoiceResponse;
type Log = { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

const MAX_CALL_S = 4 * 3600;
const ACTIVE_CALL_WINDOW_MS = MAX_CALL_S * 1000;
export const BUSINESS_PLANS = new Set<PlanCode>(["business", "business_pro"]);

const REFUSALS = {
  account_restricted: [
    "Les appels sortants sont suspendus sur ce compte d'entreprise. Communiquez avec votre administrateur.",
    "Outgoing calls are suspended on this business account. Please contact your administrator.",
  ],
  plan_canceled: [
    "L'abonnement MIMT Affaires est annulé : les appels sortants de l'entreprise sont bloqués. Les appels entrants et le 9-1-1 restent disponibles.",
    "The MIMT Business subscription is canceled: business outgoing calls are blocked. Incoming calls and 9-1-1 remain available.",
  ],
  no_number: ["Aucun numéro d'entreprise n'est configuré pour vos appels sortants.", "No business number is set up for your outgoing calls."],
  e911_required: [
    "Avant d'appeler, l'entreprise doit enregistrer son adresse 9-1-1 et vous devez accepter l'avis 9-1-1.",
    "Before calling, the business must register its 9-1-1 address and you must accept the 9-1-1 notice.",
  ],
  minutes_exhausted: ["Les minutes de l'entreprise sont épuisées pour ce mois.", "The business has used all its minutes this month."],
  too_many_calls: ["Trop d'appels en cours pour votre entreprise.", "Too many calls in progress for your business."],
  destination_blocked: ["Cette destination n'est pas permise avec votre forfait.", "This destination is not allowed on your plan."],
  intl_no_credit: ["Le crédit international de l'entreprise est insuffisant.", "The business's international credit is too low."],
  invalid_number: ["Le numéro composé n'est pas valide.", "The number you dialed is not valid."],
  rate_limited: ["Trop d'appels en peu de temps. Réessayez plus tard.", "Too many calls in a short time. Please try again later."],
} as const;

export function refuse(reason: keyof typeof REFUSALS): VR {
  const vr = new VoiceResponse();
  const [fr, en] = REFUSALS[reason];
  sayBilingual(vr, fr, en);
  vr.hangup();
  return vr;
}

const baseUrl = (deps: AppDeps) => deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");

const isBusinessPlanSub = (s: Subscription) => s.kind === "plan" && BUSINESS_PLANS.has(s.code as PlanCode);

/** The business plan subscription that counts: the live one if any, else the latest one; null if none was ever bought. */
export function businessSubscription(subs: Subscription[]): Subscription | null {
  const plans = subs.filter(isBusinessPlanSub);
  const live = plans.filter((s) => isLiveSubscription(s));
  const pool = live.length ? live : plans;
  return pool.reduce<Subscription | null>((best, s) => (!best || s.createdAt.getTime() >= best.createdAt.getTime() ? s : best), null);
}

/**
 * Plan and seats of a business; caps are per line, pooled by multiplying by the seat count. Seats are the
 * count synced from Stripe (business_seats), never above the quantity of the live business subscription.
 */
export async function businessPlan(deps: AppDeps, business: BusinessRow) {
  const [{ plan, features }, seats, account, subs] = await Promise.all([
    getFeatures(deps.repo, business.telecomAccountId),
    deps.repo.pbx.getSeats(business.id),
    deps.repo.getAccount(business.telecomAccountId),
    deps.repo.listSubscriptions(business.telecomAccountId),
  ]);
  const sub = businessSubscription(subs);
  const live = sub && isLiveSubscription(sub) ? sub : null;
  return {
    plan,
    features,
    seats: live ? Math.max(1, Math.min(seats.seats, live.quantity)) : seats.seats,
    account,
    active: BUSINESS_PLANS.has(plan),
    /** Stripe lifecycle of the business plan: past_due = payment attention, canceled/unpaid = outbound blocked. */
    billingStatus: sub?.status ?? null,
  };
}

export async function loadSnapshot(deps: AppDeps, business: BusinessRow, features?: Set<string>): Promise<router.PbxSnapshot> {
  const { pbx } = deps.repo;
  const [extensions, ringGroups, ivrMenus, hours, f] = await Promise.all([
    pbx.listExtensions(business.id),
    pbx.listRingGroups(business.id),
    pbx.listIvrMenus(business.id),
    pbx.getHours(business.id),
    features ? Promise.resolve({ features }) : getFeatures(deps.repo, business.telecomAccountId),
  ]);
  return {
    business,
    extensions,
    ringGroups,
    ivrMenus,
    hours,
    canRecord: f.features.has("call_recording"),
    transcribe: f.features.has("vm_transcription"),
  };
}

/** Number id voicemails are filed under: the called DID, else the main number, else any routed DID. */
async function fileNumberId(deps: AppDeps, business: BusinessRow): Promise<string> {
  const main = business.mainNumber ? await deps.repo.getNumberByE164(business.mainNumber) : null;
  if (main?.telecomAccountId === business.telecomAccountId) return main.id;
  return (await deps.repo.pbx.listDidRoutes(business.id))[0]?.phoneNumberId ?? "";
}

function notInService(): VR {
  const vr = new VoiceResponse();
  sayBilingual(vr, NOT_IN_SERVICE.fr, NOT_IN_SERVICE.en);
  vr.hangup();
  return vr;
}

/**
 * Call to a number with a DID route (PSTN inbound, or an app user dialing a business number).
 * Returns null when the number is not a business DID, so the consumer path runs unchanged.
 */
export async function pbxInbound(
  deps: AppDeps,
  input: { to: string | undefined; from: string | undefined; callSid: string | undefined; fromApp?: { userId: string; callerId?: string } },
): Promise<VR | null> {
  if (!input.to) return null;
  const { repo } = deps;
  const route = await repo.pbx.getDidRouteByE164(input.to);
  if (!route) return null;
  const business = await repo.pbx.getBusiness(route.businessId);
  const number = await repo.getNumber(route.phoneNumberId);
  const info = business ? await businessPlan(deps, business) : null;
  const account = info?.account;
  if (!business || !info || !account || !number || number.telecomAccountId !== account.id || !HELD_STATES.has(number.state)) return notInService();
  if (account.status === "SUSPENDED" || account.status === "CLOSED") return notInService();

  const now = deps.now();
  if (input.callSid) {
    await repo.upsertCall({
      twilioCallSid: input.callSid,
      telecomAccountId: account.id,
      userId: input.fromApp?.userId ?? null,
      direction: input.fromApp ? "outbound" : "inbound",
      kind: input.fromApp ? "app" : "pstn",
      fromNumber: input.fromApp ? (input.fromApp.callerId ?? `client:${input.fromApp.userId}`) : (input.from ?? "unknown"),
      toNumber: number.e164,
      status: "ringing",
      startedAt: now,
    });
  }
  const snap = await loadSnapshot(deps, business, info.features);
  const ctx: router.RouteContext = { snap, now, base: baseUrl(deps), numberId: number.id, ...(input.fromApp ? { callerId: number.e164 } : {}) };

  // Pooled inbound minutes (per-line cap × seats): past the pool, callers go straight to voicemail.
  const caps = PLANS[info.active ? info.plan : "business"].caps;
  const usage = await repo.getUsage(account.id, monthPeriod(now));
  if (!input.fromApp && !checkInboundCaps({ caps: { ...caps, inboundMinutes: caps.inboundMinutes * info.seats }, usage }).ok) {
    return router.voicemail(ctx, {});
  }
  return router.inbound(ctx, route.target);
}

/** Businesses the user is an active member of, with the user's extension in each (if any). */
async function memberships(deps: AppDeps, userId: string) {
  const [list, exts] = await Promise.all([deps.repo.pbx.listBusinessesForUser(userId), deps.repo.pbx.listExtensionsByUser(userId)]);
  return list.map((m) => ({ ...m, extension: exts.find((e) => e.businessId === m.business.id) ?? null }));
}

/**
 * Outbound hook for calls placed from the MIMT apps. Runs after the 9-1-1 check and the user lookup.
 * Returns null to let the consumer path handle the call unchanged.
 */
export async function pbxOutbound(
  deps: AppDeps,
  log: Log,
  input: { user: User; consumerAccount: TelecomAccount; dialed: string; callSid: string | undefined; callerId: string | undefined },
): Promise<VR | null> {
  const { repo } = deps;
  const dialed = input.dialed.trim();

  // 1. Internal extension (or ring group number) of one of the caller's businesses: rings the apps, free.
  if (isValidExtension(dialed)) {
    for (const m of await memberships(deps, input.user.id)) {
      const ext = await repo.pbx.findExtensionByNumber(m.business.id, dialed);
      const group = ext ? null : (await repo.pbx.listRingGroups(m.business.id)).find((g) => g.number === dialed);
      if (!ext && !group) continue;
      const snap = await loadSnapshot(deps, m.business);
      // Internal calls are not recorded (the recording policy covers calls with outside parties).
      snap.canRecord = false;
      const ctx: router.RouteContext = {
        snap,
        now: deps.now(),
        base: baseUrl(deps),
        numberId: await fileNumberId(deps, m.business),
        ...(m.extension?.did || m.business.mainNumber ? { callerId: (m.extension?.did ?? m.business.mainNumber)! } : {}),
      };
      if (input.callSid) {
        await repo.upsertCall({
          twilioCallSid: input.callSid,
          telecomAccountId: m.business.telecomAccountId,
          userId: input.user.id,
          direction: "outbound",
          kind: "app",
          fromNumber: m.extension ? `ext:${m.extension.number}` : `client:${input.user.id}`,
          toNumber: `ext:${dialed}`,
          status: "initiated",
          startedAt: ctx.now,
        });
      }
      return ext ? router.dialExtension(ctx, ext) : router.dialRingGroup(ctx, group!);
    }
    return null;
  }

  const to = normalizeDialed(dialed);
  if (!to) return null;

  // 2. A business DID dialed from the app: routed through that business's PBX like an inbound call, free.
  if (await repo.pbx.getDidRouteByE164(to)) {
    return pbxInbound(deps, { to, from: undefined, callSid: input.callSid, fromApp: { userId: input.user.id, callerId: input.callerId } });
  }

  // 3. PSTN call on behalf of a business.
  const pick = await pickBusinessLine(deps, input.user.id, input.consumerAccount, input.callerId);
  if (!pick) return null;
  return businessPstn(deps, log, { ...pick, user: input.user, to, callSid: input.callSid });
}

/**
 * Which business (if any) this outbound call is for: the one whose number the app asked to call from,
 * or, when the user holds no personal number, the first business where they have an extension.
 */
async function pickBusinessLine(deps: AppDeps, userId: string, consumer: TelecomAccount, requested: string | undefined) {
  const list = await memberships(deps, userId);
  if (!list.length) return null;
  const owns = async (b: BusinessRow, e164: string | null | undefined) => {
    if (!e164) return false;
    const n = await deps.repo.getNumberByE164(e164);
    return Boolean(n && n.telecomAccountId === b.telecomAccountId && HELD_STATES.has(n.state));
  };
  if (requested) {
    for (const m of list) {
      if ((requested === m.business.mainNumber || requested === m.extension?.did) && (await owns(m.business, requested))) {
        return { business: m.business, extension: m.extension, callerId: requested };
      }
    }
    // The app asked for another (personal) number: consumer rules.
    return null;
  }
  const personal = (await deps.repo.listNumbersByAccount(consumer.id)).some((n) => HELD_STATES.has(n.state));
  if (personal) return null;
  for (const m of list) {
    if (!m.extension) continue;
    for (const candidate of [m.extension.did, m.business.mainNumber]) {
      if (await owns(m.business, candidate)) return { business: m.business, extension: m.extension, callerId: candidate! };
    }
    return { business: m.business, extension: m.extension, callerId: null };
  }
  return null;
}

async function businessPstn(
  deps: AppDeps,
  log: Log,
  input: { business: BusinessRow; extension: ExtensionRow | null; callerId: string | null; user: User; to: string; callSid: string | undefined },
): Promise<VR | null> {
  const { repo, config } = deps;
  const { business, user, to } = input;
  const info = await businessPlan(deps, business);
  const account = info.account;
  if (!account) return null;
  // Business plan canceled or unpaid in Stripe: no business outbound calls (9-1-1 was handled before this hook,
  // inbound calls to the business keep ringing).
  if (!info.active && (info.billingStatus === "canceled" || info.billingStatus === "unpaid")) return refuse("plan_canceled");
  // Never had a business plan: not a business call (the consumer rules apply).
  if (!info.active) return null;
  if (outboundBlocked(account)) return refuse("account_restricted");
  if (!input.callerId) return refuse("no_number");

  const e911 = await e911Ready(deps, user.id, account.id);
  if (!e911.address || !e911.ack) return refuse("e911_required");

  const rlKey = `${account.id}:${user.id}`;
  const okMinute = await deps.rateLimiter.take(`call:m:${rlKey}`, CALL_ATTEMPT_RULES.minute);
  const okHour = okMinute && (await deps.rateLimiter.take(`call:h:${rlKey}`, CALL_ATTEMPT_RULES.hour));
  const fraud = (rule: string, details: Record<string, unknown>, action: "block" | "suspend" = "block") =>
    repo.addFraudEvent({ telecomAccountId: account.id, rule, score: action === "suspend" ? 100 : 50, action, details: { ...details, userId: user.id } });
  if (!okHour) {
    await fraud("call_attempt_rate", { to });
    return refuse("rate_limited");
  }

  const now = deps.now();
  const today = await repo.getUsage(account.id, dayPeriod(now));
  if (exceedsDailySpend(today.spendCad, config.DAILY_SPEND_ALERT_CAD)) {
    if (account.status !== "OUTBOUND_SUSPENDED") {
      await setAccountStatus(repo, account, "OUTBOUND_SUSPENDED", "daily_spend_guard");
      await fraud("daily_spend_guard", { spendCad: today.spendCad, limitCad: config.DAILY_SPEND_ALERT_CAD }, "suspend");
    }
    return refuse("account_restricted");
  }

  const dest = checkVoiceDestination(to, { entitled: info.features.has("intl_calling"), creditCents: account.intlCreditCents });
  if (!dest.ok) {
    if (dest.reason === "invalid_number") return refuse("invalid_number");
    await fraud(`destination_${dest.reason}`, { to, zone: dest.zone });
    return refuse(dest.reason === "intl_no_credit" ? "intl_no_credit" : "destination_blocked");
  }

  // Caps per line × seats (pooled), concurrent calls: per line for the user, × seats for the business.
  const caps = effectiveCaps(info.plan, account.riskTier, account.createdAt, now);
  const since = new Date(now.getTime() - ACTIVE_CALL_WINDOW_MS);
  const [businessActive, userActive] = await Promise.all([
    repo.countActiveCalls(account.id, since),
    repo.pbx.countActiveCallsByUser(account.id, user.id, since),
  ]);
  if (businessActive >= caps.concurrentCalls * info.seats || userActive >= caps.concurrentCalls) return refuse("too_many_calls");

  let timeLimit: number;
  if (isDomesticZone(dest.zone)) {
    const usage = await repo.getUsage(account.id, monthPeriod(now));
    const remaining = caps.outboundMinutes * info.seats + usage.bonusMinutesOut - usage.minutesOut;
    if (remaining <= 0) return refuse("minutes_exhausted");
    timeLimit = Math.min(remaining * 60, MAX_CALL_S);
  } else {
    timeLimit = Math.min(Math.floor(account.intlCreditCents / config.INTL_ASSUMED_RATE_CENTS_PER_MIN) * 60, MAX_CALL_S);
    if (timeLimit < 60) return refuse("intl_no_credit");
  }

  if (input.callSid) {
    await repo.upsertCall({
      twilioCallSid: input.callSid,
      telecomAccountId: account.id,
      userId: user.id,
      direction: "outbound",
      kind: "pstn",
      fromNumber: input.callerId,
      toNumber: to,
      status: "initiated",
      startedAt: now,
    });
  }
  log.warn({ businessId: business.id, callSid: input.callSid }, "business outbound call");

  const vr = new VoiceResponse();
  const policy = business.recordingPolicy;
  const canRecord = info.features.has("call_recording");
  const base = baseUrl(deps);
  // Recording notice, French first: to our user here, and to the called party before they are connected.
  if (canRecord && policy.mode !== "off") router.say(vr, policy.consentPrompt);
  const recordAll = canRecord && policy.mode === "all";
  const dial = vr.dial({
    callerId: input.callerId,
    timeLimit,
    answerOnBridge: true,
    ...(recordAll
      ? {
          record: "record-from-answer-dual" as const,
          recordingStatusCallback: router.pbxUrl(base, "recording", { b: business.id, s: "all", x: input.extension?.id }),
          recordingStatusCallbackMethod: "POST",
          recordingStatusCallbackEvent: ["completed" as const],
        }
      : {}),
  });
  if (canRecord && policy.mode !== "off") dial.number({ url: router.pbxUrl(base, "consent", { b: business.id }), method: "POST" }, to);
  else dial.number(to);
  return vr;
}
