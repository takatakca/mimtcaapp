import type { FastifyInstance } from "fastify";
import { QUEBEC_AREA_CODES, NANP_E164, type AvailableNumbersResponse, type ClaimNumberResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { conflict, forbidden, notConfigured } from "../lib/errors.js";
import { classifyDestination } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import { getFeatures, HELD_STATES, outboundBlocked } from "../services/accounts.js";
import { FREE_QUOTA_MESSAGE, freeNumberAvailable } from "../services/freeTier.js";
import { e911Ready } from "./e911.js";

const DEFAULT_AREA_CODES = ["514", "438", "450", "418", "819", "581", "579", "873"] as const satisfies readonly (typeof QUEBEC_AREA_CODES)[number][];

export async function numberRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, config } = deps;
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");

  app.get("/v1/numbers/available", { preHandler: requireUser(deps) }, async (req): Promise<AvailableNumbersResponse> => {
    const { areaCode } = parse(z.object({ areaCode: z.string().regex(/^[2-9]\d{2}$/).optional() }), req.query);
    if (!deps.twilio) throw notConfigured("Number search");
    const codes = areaCode ? [areaCode] : DEFAULT_AREA_CODES;
    for (const code of codes) {
      const found = await deps.twilio.searchLocalNumbers({ areaCode: code, limit: 20 });
      // Never offer a number we still hold or keep in quarantine.
      const free = [];
      for (const n of found) {
        const existing = await repo.getNumberByE164(n.e164);
        if (!existing || existing.state === "released") free.push(n);
      }
      if (free.length) return { areaCode: code, numbers: free };
    }
    return { areaCode: areaCode ?? null, numbers: [] };
  });

  app.post("/v1/numbers/claim", { preHandler: requireUser(deps) }, async (req, reply) => {
    const { e164 } = parse(z.object({ e164: z.string().regex(NANP_E164) }), req.body);
    const { user, account } = await loadContext(deps, req);

    if (outboundBlocked(account)) throw forbidden("account_restricted");
    const e911 = await e911Ready(deps, user.id, account.id);
    if (!e911.address) throw forbidden("e911_address_required", "Register a 9-1-1 civic address first");
    if (!e911.ack) throw forbidden("e911_ack_required", "Accept the current 9-1-1 notice first");
    if (!user.phoneVerifiedAt && !user.deviceVerifiedAt) throw forbidden("verification_required", "Verify your phone or device first");
    if (classifyDestination(e164) !== "ca") throw forbidden("canadian_numbers_only");

    const { extraNumbers, plan } = await getFeatures(repo, account.id);
    if (plan === "free" && config.DEVICE_ATTESTATION_REQUIRED && !user.deviceVerifiedAt) {
      throw forbidden("device_attestation_required", "Confirmez cet appareil avant d'obtenir un numéro gratuit.");
    }
    const held = (await repo.listNumbersByAccount(account.id)).filter((n) => HELD_STATES.has(n.state));
    if (held.length >= 1 + extraNumbers) throw forbidden("number_limit_reached", "Your plan allows no more numbers");
    // Free-tier cost guard (services/freeTier.ts): each free number costs MIMT about C$2.64/month before any ad revenue.
    if (plan === "free" && !(await freeNumberAvailable(deps))) throw conflict("free_quota_reached", FREE_QUOTA_MESSAGE);

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

    // meta.plan + at feed the daily free-number count (repo.countFreeNumberClaimsSince).
    await repo.audit({ actorUserId: user.id, action: "number.claimed", targetType: "phone_number", targetId: number.id, ip: req.ip, meta: { e164, plan }, at: now });
    await repo.enqueueOutbox("phone_number.assigned", {
      phone_number_id: number.id,
      e164,
      telecom_account_id: account.id,
      global_user_id: user.globalUserId,
      workspace_id: account.workspaceId,
    });
    const res: ClaimNumberResponse = { id: number.id, e164: number.e164, state: number.state };
    return reply.code(201).send(res);
  });
}
