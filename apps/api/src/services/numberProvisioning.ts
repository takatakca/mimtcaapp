import type { AppDeps } from "../deps.js";
import type { TelecomAccount } from "../repo/types.js";
import { LIVE_HOLD_STATES } from "../repo/numberHolds.js";
import { grantMission } from "./missions.js";

/**
 * Buys the number a visitor held in the picker, once Stripe confirms the payment (checkout.session.completed with
 * metadata.number_hold_id). Idempotent: a converted hold is skipped, so webhook retries never buy twice.
 *
 * - The number was taken in the meantime (MIMT customer or carrier): the hold becomes "failed" and the paid plan
 *   stays; the customer picks another number in the app (POST /v1/numbers/claim works on a paid plan).
 * - Twilio errors are thrown so Stripe retries the webhook; the hold stays in "checkout" until then.
 */
export async function provisionHeldNumber(
  deps: AppDeps,
  holdId: string,
  account: TelecomAccount,
): Promise<"provisioned" | "skipped" | "failed"> {
  const { repo } = deps;
  const hold = await repo.numberHolds.get(holdId);
  if (!hold || hold.telecomAccountId !== account.id || !LIVE_HOLD_STATES.has(hold.status)) return "skipped";
  if (!deps.twilio) throw new Error("Twilio is not configured: cannot provision a paid number");

  const existing = await repo.getNumberByE164(hold.e164);
  if (existing && existing.state !== "released") {
    await repo.numberHolds.finish(hold.id, "failed");
    await repo.audit({ actorUserId: null, action: "number.hold_failed", targetType: "telecom_account", targetId: account.id, meta: { e164: hold.e164, reason: "taken" } });
    return "failed";
  }

  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const address = await repo.getE911Address(account.id);
  let sid: string;
  try {
    ({ sid } = await deps.twilio.purchaseNumber({
      e164: hold.e164,
      voiceUrl: `${base}/webhooks/twilio/voice/inbound`,
      smsUrl: `${base}/webhooks/twilio/sms/inbound`,
      statusCallback: `${base}/webhooks/twilio/voice/status`,
      ...(address?.providerRef ? { emergencyAddressSid: address.providerRef } : {}),
    }));
  } catch (err) {
    // Twilio answers 400 when the number is no longer available: final. Anything else: let Stripe retry.
    if ((err as { status?: number }).status === 400) {
      await repo.numberHolds.finish(hold.id, "failed");
      await repo.audit({ actorUserId: null, action: "number.hold_failed", targetType: "telecom_account", targetId: account.id, meta: { e164: hold.e164, reason: "carrier" } });
      return "failed";
    }
    throw err;
  }

  const now = deps.now();
  const fields = {
    twilioSid: sid,
    telecomAccountId: account.id,
    kind: "local" as const,
    state: "active" as const,
    lastActivityAt: now,
    stateChangedAt: now,
    quarantineUntil: null,
    warningsSent: [],
  };
  const number = existing ? await repo.updateNumber(existing.id, fields) : await repo.createNumber({ e164: hold.e164, ...fields });
  await repo.numberHolds.finish(hold.id, "converted");

  const owner = await repo.getUser(account.ownerUserId);
  await repo.audit({ actorUserId: account.ownerUserId, action: "number.claimed", targetType: "phone_number", targetId: number.id, meta: { e164: hold.e164, via: "picker" }, at: now });
  await repo.enqueueOutbox("phone_number.assigned", {
    phone_number_id: number.id,
    e164: hold.e164,
    telecom_account_id: account.id,
    global_user_id: owner?.globalUserId ?? null,
    workspace_id: account.workspaceId,
  });
  // Mission « Obtenez votre numéro »: Stripe confirmed the plan, the number is bought.
  await grantMission(deps, { account, user: owner, mission: "first_number", sourceRef: "number:picker" });
  return "provisioned";
}
