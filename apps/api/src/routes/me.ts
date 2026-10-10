import type { FastifyInstance } from "fastify";
import type { ConsentResponse, DeleteMeResponse, MeExportResponse, MeResponse, UpdateMeResponse } from "@mimt/shared";
import { QUARANTINE_DAYS, USER_CONSENT_KINDS } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { addDays, monthPeriod } from "../lib/time.js";
import { parse } from "../lib/validate.js";
import { getFeatures, HELD_STATES, setAccountStatus } from "../services/accounts.js";
import { messageDto } from "./messages.js";

const DELETION_DELAY_DAYS = 30;

const PatchBody = z
  .object({
    locale: z.enum(["fr-CA", "en-CA"]).optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
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
        outboundSms: usage.smsOut,
        periodStart: `${monthPeriod(now)}-01T00:00:00.000Z`,
      },
    };
  });

  app.patch("/v1/me", auth, async (req): Promise<UpdateMeResponse> => {
    const body = parse(PatchBody, req.body);
    const { user } = await loadContext(deps, req);
    const updated = await repo.updateUser(user.id, {
      ...(body.locale ? { locale: body.locale } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    });
    return { id: updated.id, locale: updated.locale, displayName: updated.displayName };
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
    const [subscriptions, numbers, address, acks, consents, calls, voicemails, conversations] = await Promise.all([
      repo.listSubscriptions(account.id),
      repo.listNumbersByAccount(account.id),
      repo.getE911Address(account.id),
      repo.listE911Acks(user.id),
      repo.listConsents(user.id),
      repo.listCalls(account.id, 10_000),
      repo.listVoicemails(account.id),
      repo.listConversations(account.id),
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
