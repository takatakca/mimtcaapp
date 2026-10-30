import type { FastifyInstance } from "fastify";
import { QUEBEC_AREA_CODES, NANP_E164, type AvailableNumbersResponse, type ClaimNumberResponse, type ProvisionResumeResponse, type PhoneVerificationRequiredResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { numberFallbacks } from "../gateways/twilio.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { conflict, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { classifyDestination } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import { getFeatures, HELD_STATES, outboundBlocked } from "../services/accounts.js";
import { FREE_QUOTA_MESSAGE, freeNumberAvailable, NUMBER_REQUIRES_PAID_MESSAGE } from "../services/freeTier.js";
import { planOf } from "../plansConfig.js";
import { e911Ready } from "./e911.js";
import { grantMission } from "../services/missions.js";
import { provisionHeldNumber } from "../services/numberProvisioning.js";
import { LIVE_HOLD_STATES } from "../repo/numberHolds.js";
import { holdTokenMatches } from "./numberPicker.js";

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
    // Launch pricing (docs/MIMT-UNIT-ECONOMICS.md): the free plan has no phone-network number; a number is paid up front.
    if (!planOf(plan).caps.hasNumber) throw new HttpError(402, "number_requires_paid_plan", NUMBER_REQUIRES_PAID_MESSAGE);
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
      ...numberFallbacks(config),
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
    // Mission « Obtenez votre numéro »: a number bought on a paid plan (never the legacy free number).
    const missionGranted = plan !== "free" ? await grantMission(deps, { account, user, mission: "first_number", sourceRef: "number:claim", log: req.log }) : null;
    const res: ClaimNumberResponse = { id: number.id, e164: number.e164, state: number.state, ...(missionGranted ? { missionGranted } : {}) };
    return reply.code(201).send(res);
  });

  /**
   * Purchase-time auth flow: resumes provisioning of a paid number whose purchase was deferred until the
   * owner verifies their phone (see provisionHeldNumber). The client passes the hold token from the number
   * picker as the checkout-resume token. Answers 428 `phone_verification_required` while the phone is
   * unverified; the client then drives OTP verification → passkey enrollment and calls this again.
   */
  app.post("/v1/numbers/provision/resume", { preHandler: requireUser(deps) }, async (req, reply) => {
    const { holdId, holdToken } = parse(
      z.object({ holdId: z.string().min(1).max(128), holdToken: z.string().min(16).max(256) }),
      req.body,
    );
    const { user, account } = await loadContext(deps, req);
    const hold = await repo.numberHolds.get(holdId);
    if (!hold || hold.telecomAccountId !== account.id || !LIVE_HOLD_STATES.has(hold.status) || !holdTokenMatches(hold, holdToken)) {
      throw notFound("hold_not_found", "Cette réservation de numéro est introuvable ou a expiré.");
    }
    if (!user.phoneVerifiedAt) {
      const res: PhoneVerificationRequiredResponse = { code: "phone_verification_required", holdId: hold.id, resumeToken: holdToken };
      return reply.code(428).send(res);
    }
    const status = await provisionHeldNumber(deps, hold.id, account);
    if (status === "provisioned" && user.onboardingStage !== "full") {
      await repo.updateUser(user.id, { onboardingStage: "full" });
    }
    const res: ProvisionResumeResponse = { status, holdId: hold.id };
    return res;
  });
}
