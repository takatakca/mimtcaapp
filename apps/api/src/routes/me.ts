import type { FastifyInstance } from "fastify";
import type { ConsentResponse, ConsentsResponse, DeleteMeResponse, MeExportResponse, MeResponse, UpdateMeResponse } from "@mimt/shared";
import {
  FORWARDING_TIMEOUT_MAX_S,
  FORWARDING_TIMEOUT_MIN_S,
  QUARANTINE_DAYS,
  USER_CONSENT_KINDS,
  WEEKDAYS,
  isValidHhmm,
  type CallSettings,
  type UserConsentKind,
  type Weekday,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { addDays, monthPeriod } from "../lib/time.js";
import { parse } from "../lib/validate.js";
import { badRequest, forbidden } from "../lib/errors.js";
import type { TelecomAccount } from "../repo/types.js";
import { getFeatures, HELD_STATES, setAccountStatus } from "../services/accounts.js";
import { checkForwardTarget } from "../services/callControls.js";
import { blockDto } from "./blocks.js";
import { messageDto } from "./messages.js";

const DELETION_DELAY_DAYS = 30;

const Hhmm = z.string().refine(isValidHhmm, "expected HH:MM");
const TimeRange = z.object({ open: Hhmm, close: Hhmm }).strict().refine((r) => r.open !== r.close, "empty range");

const PatchBody = z
  .object({
    locale: z.enum(["fr-CA", "en-CA"]).optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    forwarding: z
      .object({
        mode: z.enum(["off", "always", "no_answer"]),
        target: z.string().trim().min(3).max(32).nullable().optional(),
        timeoutS: z.number().int().min(FORWARDING_TIMEOUT_MIN_S).max(FORWARDING_TIMEOUT_MAX_S).optional(),
      })
      .strict()
      .optional(),
    dnd: z
      .object({
        enabled: z.boolean(),
        schedule: z
          .object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(TimeRange).max(4)])) as Record<Weekday, z.ZodArray<typeof TimeRange>>)
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    blockedCallAction: z.enum(["reject", "voicemail"]).optional(),
  })
  .strict();

const ConsentBody = z.object({
  kind: z.enum(USER_CONSENT_KINDS),
  granted: z.boolean(),
  version: z.string().min(1).max(64),
  source: z.string().max(64).default("app"),
});

export async function meRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };

  app.get("/v1/me", auth, async (req): Promise<MeResponse> => {
    const { user, account } = await loadContext(deps, req);
    const now = deps.now();
    const [{ plan, addOns }, numbers, address, ack, usage] = await Promise.all([
      getFeatures(repo, account.id),
      repo.listNumbersByAccount(account.id),
      repo.getE911Address(account.id),
      repo.getLatestE911Ack(user.id),
      repo.getUsage(account.id, monthPeriod(now)),
    ]);
    return {
      user: { id: user.id, globalUserId: user.globalUserId, locale: user.locale, displayName: user.displayName },
      account: { id: account.id, kind: account.kind, plan, status: account.status, addOns, intlCreditCents: account.intlCreditCents },
      numbers: numbers.filter((n) => HELD_STATES.has(n.state)).map((n) => ({ id: n.id, e164: n.e164, state: n.state })),
      e911: {
        addressRegistered: Boolean(address),
        noticeAccepted: ack?.noticeVersion === deps.config.E911_NOTICE_VERSION,
        noticeVersion: deps.config.E911_NOTICE_VERSION,
      },
      usage: {
        outboundMinutes: usage.minutesOut,
        inboundMinutes: usage.minutesIn,
        messages: usage.smsOut + usage.smsIn,
        periodStart: `${monthPeriod(now)}-01T00:00:00.000Z`,
      },
      callSettings: await repo.callControls.getCallSettings(account.id),
    };
  });

  app.patch("/v1/me", auth, async (req): Promise<UpdateMeResponse> => {
    const body = parse(PatchBody, req.body);
    const { user, account } = await loadContext(deps, req);
    // Call settings first: a refused forwarding target leaves the whole request unapplied.
    const callSettings = await updateCallSettings(account, body, user.id, req.ip);
    const updated = await repo.updateUser(user.id, {
      ...(body.locale ? { locale: body.locale } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    });
    return { id: updated.id, locale: updated.locale, displayName: updated.displayName, callSettings };
  });

  /** Applies forwarding / do not disturb / blocked-call changes. Forwarding needs the call_forwarding plan feature. */
  async function updateCallSettings(account: TelecomAccount, body: z.infer<typeof PatchBody>, userId: string, ip: string): Promise<CallSettings> {
    const current = await repo.callControls.getCallSettings(account.id);
    if (!body.forwarding && !body.dnd && !body.blockedCallAction) return current;
    const next: CallSettings = structuredClone(current);
    if (body.forwarding) {
      const f = body.forwarding;
      const rawTarget = f.target === undefined ? current.forwarding.target : f.target;
      next.forwarding = { mode: f.mode, target: rawTarget, timeoutS: f.timeoutS ?? current.forwarding.timeoutS };
      if (f.mode !== "off") {
        const { features } = await getFeatures(repo, account.id);
        if (!features.has("call_forwarding")) throw forbidden("plan_required", "Call forwarding needs a Premium or Business plan");
        if (!rawTarget) throw badRequest("forwarding_target_required", "A forwarding number is required");
      }
      if (rawTarget && rawTarget !== current.forwarding.target) {
        const check = await checkForwardTarget(deps, account, rawTarget);
        if (!check.ok) {
          await repo.addFraudEvent({ telecomAccountId: account.id, rule: `forwarding_${check.reason}`, score: 50, action: "block", details: { target: rawTarget } });
          throw badRequest("forwarding_destination_not_allowed", check.reason);
        }
        next.forwarding.target = check.target;
      }
    }
    if (body.dnd) next.dnd = { enabled: body.dnd.enabled, schedule: body.dnd.schedule === undefined ? current.dnd.schedule : body.dnd.schedule };
    if (body.blockedCallAction) next.blockedCallAction = body.blockedCallAction;
    const saved = await repo.callControls.saveCallSettings(account.id, next);
    await repo.audit({
      actorUserId: userId,
      action: "call_settings.updated",
      targetType: "telecom_account",
      targetId: account.id,
      ip,
      meta: { forwardingMode: saved.forwarding.mode, dnd: saved.dnd.enabled, blockedCallAction: saved.blockedCallAction },
    });
    return saved;
  }

  app.get("/v1/consents", auth, async (req): Promise<ConsentsResponse> => {
    const { user } = await loadContext(deps, req);
    const history = await repo.listConsents(user.id);
    const latest = new Map<UserConsentKind, ConsentResponse>();
    for (const row of history) {
      if (!USER_CONSENT_KINDS.includes(row.kind as UserConsentKind)) continue;
      const kind = row.kind as UserConsentKind;
      const at = row.at.toISOString();
      const previous = latest.get(kind);
      if (!previous || at >= previous.at) {
        latest.set(kind, { id: row.id, kind, granted: row.granted, version: row.version, at });
      }
    }
    return { consents: USER_CONSENT_KINDS.flatMap((kind) => {
      const entry = latest.get(kind);
      return entry ? [entry] : [];
    }) };
  });

  app.post("/v1/consents", auth, async (req, reply) => {
    const body = parse(ConsentBody, req.body);
    const { user } = await loadContext(deps, req);
    const c = await repo.addConsent({ userId: user.id, ...body, ip: req.ip, at: deps.now() });
    const res: ConsentResponse = { id: c.id, kind: c.kind, granted: c.granted, version: c.version, at: c.at.toISOString() };
    return reply.code(201).send(res);
  });

  // Law 25 portability: everything we hold about the user, in a structured, commonly used format.
  app.get("/v1/me/export", auth, async (req, reply): Promise<MeExportResponse> => {
    const { user, account } = await loadContext(deps, req);
    const [subscriptions, numbers, address, acks, consents, calls, voicemails, conversations, blocks, callSettings] = await Promise.all([
      repo.listSubscriptions(account.id),
      repo.listNumbersByAccount(account.id),
      repo.getE911Address(account.id),
      repo.listE911Acks(user.id),
      repo.listConsents(user.id),
      repo.listCalls(account.id, 10_000),
      repo.listVoicemails(account.id),
      repo.listConversations(account.id),
      repo.callControls.listBlocks(account.id),
      repo.callControls.getCallSettings(account.id),
    ]);
    const messages = [];
    for (const c of conversations) {
      for (const m of await repo.listMessages(account.id, c.peer, { limit: 10_000 })) messages.push(messageDto(deps, m));
    }
    await repo.audit({ actorUserId: user.id, action: "user.data_exported", targetType: "user", targetId: user.id, ip: req.ip });
    reply.header("content-disposition", `attachment; filename="mimt-export-${user.id}.json"`);
    return {
      exportedAt: deps.now().toISOString(),
      format: "mimt-export-v1",
      user: { ...user, authUserId: undefined },
      account: { ...account, twilioSubaccountSid: undefined },
      subscriptions,
      numbers: numbers.map(({ twilioSid: _sid, ...n }) => n),
      e911Address: address ? { ...address, providerRef: undefined } : null,
      e911Acknowledgements: acks,
      consents,
      calls: calls.map(({ twilioCallSid: _sid, ...c }) => c),
      voicemails: voicemails.map(({ audioUrl: _url, audioPath: _path, ...v }) => v),
      messages,
      blockedNumbers: blocks.map(blockDto),
      callSettings,
    };
  });

  // Schedules deletion; numbers go to quarantine (never handed to someone else before it ends).
  app.delete("/v1/me", auth, async (req, reply) => {
    const { user, account } = await loadContext(deps, req);
    const now = deps.now();
    await repo.updateUser(user.id, { status: "pending_deletion", deletionScheduledAt: addDays(now, DELETION_DELAY_DAYS) });
    for (const n of await repo.listNumbersByAccount(account.id)) {
      if (!HELD_STATES.has(n.state)) continue;
      await repo.updateNumber(n.id, { state: "quarantine", stateChangedAt: now, quarantineUntil: addDays(now, QUARANTINE_DAYS) });
    }
    await setAccountStatus(repo, account, "CLOSED", "user_deletion_request");
    await repo.revokeUserRefreshTokens(user.id);
    await repo.deletePushTokensForUser(user.id);
    await repo.audit({ actorUserId: user.id, action: "user.deletion_requested", targetType: "user", targetId: user.id, ip: req.ip });
    // TODO: cancel Stripe subscriptions and run the hard-delete job after DELETION_DELAY_DAYS (keep CDRs per retention policy).
    const res: DeleteMeResponse = { status: "pending_deletion", deletionScheduledAt: addDays(now, DELETION_DELAY_DAYS).toISOString() };
    return reply.code(202).send(res);
  });
}
