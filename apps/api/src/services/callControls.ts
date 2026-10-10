// Consumer call controls on the inbound path: call blocking, do not disturb and call forwarding.
// Never used on the outbound path, so 9-1-1 (routes/twilioVoice.ts `emergency`) is unaffected.

import { dndActive, isEmergencyNumber, type CallSettings } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { checkVoiceCaps, effectiveCaps, exceedsDailySpend } from "../fraud/caps.js";
import { checkVoiceDestination } from "../fraud/destinations.js";
import { isDomesticZone, normalizeDialed } from "../lib/phone.js";
import { dayPeriod, monthPeriod } from "../lib/time.js";
import type { PhoneNumber, TelecomAccount } from "../repo/types.js";
import { VoiceResponse } from "../routes/twiml.js";
import { getFeatures, outboundBlocked, usagePeriods } from "./accounts.js";

type VR = InstanceType<typeof VoiceResponse>;

/** How long the forwarded leg rings before the caller goes to voicemail. */
const FORWARD_RING_S = 25;
const MAX_FORWARD_S = 4 * 3600;
/** Same rough domestic estimate as twilioVoice.ts until Twilio reports the real price. */
const DOMESTIC_EST_CAD_PER_MIN = 0.02;

export type ForwardTargetCheck = { ok: true; target: string } | { ok: false; reason: string };

/**
 * Destination rules for a forwarding target. Same fraud controls as outbound calls
 * (fraud/destinations.ts), restricted to Canada/US: forwarded minutes come out of the plan's minutes
 * and are never billed against international credit. MIMT numbers and 9-1-1 are refused (loops).
 */
export async function checkForwardTarget(deps: AppDeps, account: TelecomAccount, raw: string): Promise<ForwardTargetCheck> {
  if (isEmergencyNumber(raw)) return { ok: false, reason: "emergency_not_allowed" };
  const target = normalizeDialed(raw);
  if (!target) return { ok: false, reason: "invalid_number" };
  const { plan, features } = await getFeatures(deps.repo, account.id);
  const dest = checkVoiceDestination(target, { entitled: plan !== "free" && features.has("intl_calling"), creditCents: account.intlCreditCents });
  if (!dest.ok) return { ok: false, reason: dest.reason };
  if (!isDomesticZone(dest.zone)) return { ok: false, reason: "intl_forwarding_not_allowed" };
  if (await deps.repo.getNumberByE164(target)) return { ok: false, reason: "mimt_number_not_allowed" };
  return { ok: true, target };
}

export interface InboundControls {
  /** Blocked caller and the user chose "reject": answer with this TwiML, record nothing. */
  reject?: VR;
  /** Blocked caller (action "voicemail") or do not disturb: go straight to voicemail. */
  voicemail?: boolean;
  /** Forwarding "always": answer with this TwiML (dials the target). */
  forward?: VR;
  /** Forwarding "no_answer": ring the apps this long, then /dial-result forwards. */
  ringTimeoutS?: number;
}

/** Decides what happens to a PSTN call to `number` before the owner's apps ring. Fails open (rings as usual). */
export async function inboundCallControls(
  deps: AppDeps,
  input: { account: TelecomAccount; number: PhoneNumber; from: string | undefined; callSid: string | undefined; now: Date },
): Promise<InboundControls> {
  try {
    return await decideInbound(deps, input);
  } catch {
    return {};
  }
}

async function decideInbound(
  deps: AppDeps,
  input: { account: TelecomAccount; number: PhoneNumber; from: string | undefined; callSid: string | undefined; now: Date },
): Promise<InboundControls> {
  const { account, number, from, now } = input;
  const settings = await deps.repo.callControls.getCallSettings(account.id);
  if (from && (await deps.repo.callControls.isBlocked(account.id, from))) {
    if (settings.blockedCallAction === "voicemail") return { voicemail: true };
    const vr = new VoiceResponse();
    vr.reject({ reason: "busy" });
    return { reject: vr };
  }
  if (dndActive(settings.dnd, now)) return { voicemail: true };
  if (settings.forwarding.mode === "always") {
    const forward = await forwardTwiml(deps, { account, number, settings, callSid: input.callSid, now });
    if (forward) return { forward };
  }
  if (settings.forwarding.mode === "no_answer") return { ringTimeoutS: settings.forwarding.timeoutS };
  return {};
}

/**
 * Hook at the top of /webhooks/twilio/voice/dial-result.
 * fw=1 (the forwarded leg ended): count its minutes when answered and hang up; otherwise null (voicemail).
 * No fw (the apps did not answer): forward when the mode is "no_answer"; otherwise null.
 */
export async function afterDialControls(
  deps: AppDeps,
  input: { numberId: string | undefined; forwarded: boolean; params: Record<string, string | undefined> },
): Promise<VR | null> {
  const p = input.params;
  if (input.forwarded) {
    if (p.DialCallStatus !== "completed") return null;
    const number = input.numberId ? await deps.repo.getNumber(input.numberId) : null;
    const duration = Number(p.DialCallDuration ?? 0) || 0;
    const key = `fwd:${p.DialCallSid ?? p.CallSid ?? ""}`;
    if (number?.telecomAccountId && duration > 0 && (await deps.repo.useOnce(key, new Date(deps.now().getTime() + 7 * 86_400_000)))) {
      const minutes = Math.ceil(duration / 60);
      await deps.repo.addUsage(number.telecomAccountId, usagePeriods(deps.now()), { minutesOut: minutes, spendCad: minutes * DOMESTIC_EST_CAD_PER_MIN });
      await deps.repo.updateNumber(number.id, { lastActivityAt: deps.now() });
    }
    const vr = new VoiceResponse();
    vr.hangup();
    return vr;
  }
  if (p.DialCallStatus === "completed" || !input.numberId) return null;
  const number = await deps.repo.getNumber(input.numberId);
  const account = number?.telecomAccountId ? await deps.repo.getAccount(number.telecomAccountId) : null;
  if (!number || !account) return null;
  const settings = await deps.repo.callControls.getCallSettings(account.id);
  if (settings.forwarding.mode !== "no_answer") return null;
  return forwardTwiml(deps, { account, number, settings, callSid: p.CallSid, now: deps.now() });
}

/** <Dial> to the forwarding target with the user's number as caller ID, or null when it may not run now. */
async function forwardTwiml(
  deps: AppDeps,
  input: { account: TelecomAccount; number: PhoneNumber; settings: CallSettings; callSid: string | undefined; now: Date },
): Promise<VR | null> {
  const { account, number, settings, now } = input;
  const { repo } = deps;
  const target = settings.forwarding.target;
  if (!target || outboundBlocked(account)) return null;
  const { plan, features } = await getFeatures(repo, account.id);
  if (!features.has("call_forwarding")) return null;

  const check = await checkForwardTarget(deps, account, target);
  if (!check.ok) {
    await repo.addFraudEvent({
      telecomAccountId: account.id,
      rule: `forwarding_${check.reason}`,
      score: 50,
      action: "block",
      details: { target, callSid: input.callSid ?? null },
    });
    return null;
  }
  const today = await repo.getUsage(account.id, dayPeriod(now));
  if (exceedsDailySpend(today.spendCad, deps.config.DAILY_SPEND_ALERT_CAD)) return null;
  // Forwarded legs use outbound minutes; the concurrency check is not applied (the inbound leg is the call).
  const caps = effectiveCaps(plan, account.riskTier, account.createdAt, now);
  const minutes = checkVoiceCaps({ caps, usage: await repo.getUsage(account.id, monthPeriod(now)), activeCalls: 0 });
  if (!minutes.ok) return null;

  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const vr = new VoiceResponse();
  vr.dial({
    callerId: number.e164,
    timeout: FORWARD_RING_S,
    timeLimit: Math.min(minutes.remaining * 60, MAX_FORWARD_S),
    answerOnBridge: true,
    action: `${base}/webhooks/twilio/voice/dial-result?n=${number.id}&fw=1`,
    method: "POST",
  }).number(check.target);
  return vr;
}
