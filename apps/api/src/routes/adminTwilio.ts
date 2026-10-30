import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { requireRecentAuth } from "../auth/stepUp.js";
import type { TwilioDiagnostics } from "../gateways/twilio.js";
import { conflict, forbidden, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { Nanp } from "../pbx/access.js";
import { ensureAccount, getFeatures } from "../services/accounts.js";
import { effectiveCaps } from "../fraud/caps.js";

const ImportBody = z.object({
  e164: Nanp,
  /** Defaults to the admin making the call (Matt's own test account). */
  ownerUserId: z.uuid().optional(),
});

/** What MIMT's webhooks expect on a number; the import only reports differences, it never changes Twilio. */
export function expectedNumberUrls(base: string) {
  return {
    voiceUrl: `${base}/webhooks/twilio/voice/inbound`,
    smsUrl: `${base}/webhooks/twilio/sms/inbound`,
    statusCallback: `${base}/webhooks/twilio/voice/status`,
    outboundUrl: `${base}/webhooks/twilio/voice/outbound`,
  };
}

/**
 * MIMT staff (CATALOG_ADMIN_USER_IDS): read-only Twilio checks and the import of a number that already exists in the
 * API's Twilio account (for example the owner's test line) into the MIMT database.
 *
 * Owner rule: numbers created before 2026-10-23 are never touched. The import writes only our database: the number keeps
 * Twilio's own creation date as `created_at`, so the lifecycle job (NUMBER_LIFECYCLE_FROM) and the fallback backfill
 * skip an older number, and nothing at Twilio is updated or released.
 */
export async function adminTwilioRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, config } = deps;
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };
  const base = () => config.PUBLIC_BASE_URL.replace(/\/$/, "");

  app.get("/v1/admin/twilio/diagnostics", admin, async (_req, reply): Promise<TwilioDiagnostics & { expected: ReturnType<typeof expectedNumberUrls> }> => {
    if (!deps.twilio?.diagnostics) throw notConfigured("Twilio");
    void reply.header("cache-control", "no-store");
    return { ...(await deps.twilio.diagnostics()), expected: expectedNumberUrls(base()) };
  });

  app.post("/v1/admin/numbers/import", admin, async (req, reply) => {
    // Attaching a phone line to an account routes its calls and texts: recent passkey or SMS confirmation first.
    await requireRecentAuth(deps, req);
    const body = parse(ImportBody, req.body);
    if (!deps.twilio?.findIncomingNumber) throw notConfigured("Twilio");

    const existing = await repo.getNumberByE164(body.e164);
    if (existing && existing.state !== "released") throw conflict("number_exists", "Ce numéro est déjà dans MIMT.");

    const found = await deps.twilio.findIncomingNumber(body.e164);
    if (!found) {
      // Twilio signs each webhook with the auth token of the account that owns the number: a number from another
      // account would be refused by our signature check, so it cannot simply be pointed at MIMT.
      throw conflict(
        "not_in_mimt_twilio_account",
        "Ce numéro n'est pas dans le compte Twilio utilisé par l'API MIMT. Ses appels seraient refusés (signature) : il faut le transférer dans ce compte.",
      );
    }

    const owner = await repo.getUser(body.ownerUserId ?? req.userId);
    if (!owner) throw notFound("user_not_found", "Utilisateur introuvable.");
    const account = await ensureAccount(repo, owner);
    const now = deps.now();
    const fields = {
      twilioSid: found.sid,
      telecomAccountId: account.id,
      kind: "local" as const,
      state: "active" as const,
      lastActivityAt: now,
      stateChangedAt: now,
      quarantineUntil: null,
      warningsSent: [],
    };
    const number = existing
      ? await repo.updateNumber(existing.id, fields)
      : await repo.createNumber({ e164: found.e164, ...fields, ...(found.dateCreated ? { createdAt: found.dateCreated } : {}) });

    const want = expectedNumberUrls(base());
    const warnings: string[] = [];
    if (found.voiceApplicationSid) warnings.push("voice_uses_twiml_app");
    else if (found.voiceUrl !== want.voiceUrl) warnings.push("voice_url_differs");
    if (found.smsUrl !== want.smsUrl) warnings.push("sms_url_differs");
    if (found.statusCallback !== want.statusCallback) warnings.push("status_callback_differs");
    // A plan with no inbound minutes sends every call straight to voicemail (fraud/caps.ts): say so before the test call.
    const { plan, trialing } = await getFeatures(repo, account.id);
    if (effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing).inboundMinutes <= 0) warnings.push("plan_sends_calls_to_voicemail");

    await repo.audit({
      actorUserId: req.userId,
      action: "number.imported",
      targetType: "phone_number",
      targetId: number.id,
      meta: { e164: number.e164, ownerUserId: owner.id, warnings },
    });
    return reply.code(201).send({
      id: number.id,
      e164: number.e164,
      state: number.state,
      telecomAccountId: account.id,
      twilio: { dateCreated: found.dateCreated?.toISOString() ?? null, voiceUrl: found.voiceUrl, smsUrl: found.smsUrl, statusCallback: found.statusCallback },
      expected: want,
      plan,
      warnings,
    });
  });
}
